"use strict";

////////////////////////////////////////////////////////////////////////////////
//
// Button
//
////////////////////////////////////////////////////////////////////////////////

const StateMachine = require('state-machine-js');

// Timeout after first press before recognizing
// it as a single press, i.e., second press must
// be received within this interval to be considered
// a double-press event.
const SINGLE_PRESS_TIMEOUT = 500;

// Timeout before a single press becomes a long
// press. If a release event is not received before
// this interval expires, then it is a long press.
const LONG_PRESS_TIMEOUT = 2000;

const State = {
    IDLE:                'IDLE',
    FIRST_PRESS:         'FIRST_PRESS',
    WAIT_SINGLE_TIMEOUT: 'WAIT_SINGLE_TIMEOUT',
    WAIT_RELEASE:        'WAIT_RELEASE'
};

const Action = {
    PRESS:          'PRESS',
    RELEASE:        'RELEASE',
    TIMEOUT_SINGLE: 'TIMEOUT_SINGLE',
    TIMEOUT_LONG:   'TIMEOUT_LONG',
    SINGLE_ONLY:    'SINGLE_ONLY'
};

const StateMachineConfig = [
    {
        initial: true,
        name: State.IDLE,
        transitions: [
            { action: Action.PRESS, target: State.FIRST_PRESS }
        ]
    },
    {
        name: State.FIRST_PRESS,
        transitions: [
            { action: Action.RELEASE, target: State.WAIT_SINGLE_TIMEOUT },
            { action: Action.TIMEOUT_LONG, target: State.WAIT_RELEASE },
            { action: Action.SINGLE_ONLY, target: State.WAIT_RELEASE }
        ]
    },
    {
        name: State.WAIT_SINGLE_TIMEOUT,
        transitions: [
            { action: Action.TIMEOUT_SINGLE, target: State.IDLE },
            { action: Action.PRESS, target: State.WAIT_RELEASE }
        ]
    },
    {
        name: State.WAIT_RELEASE,
        transitions: [
            { action: Action.RELEASE, target: State.IDLE }
        ]
    }
]

class Button {

    //
    // Constructor
    //
    constructor(device, buttonConfig) {
        this.device = device;

        if (typeof buttonConfig.id === 'undefined') {
            throw new Error(`***** Device ${device.id} button, button id MUST be configured`);
        }

        this.id = buttonConfig.id;
        this.ignore = false;

        if (buttonConfig.ignore === true) {
            Log(`Ignoring device ${device.id}, button ${this.id}`);
            this.ignore = true;
            return;
        }

        if (typeof buttonConfig.name === 'undefined') {
            throw new (`***** Device ${device.id} button ${buttonConfig.id}, name MUST be configured if not ignored`);
        }

        this.name = buttonConfig.name;

        this.pressTimeout = Config['pressTimeout'] || SINGLE_PRESS_TIMEOUT;
        this.longTimeout = Config['longTimeout'] || LONG_PRESS_TIMEOUT;
        this.singlePressOnly = buttonConfig.singlePressOnly || device.singlePressOnly;

        this.timer1 = null; // Single press timer
        this.timer2 = null; // Long press timer

        // Sanity checks complete

        // Add service if it does not already exist
        this.service = device.accessory.getServiceById(Service.StatelessProgrammableSwitch, this.name);
        if (typeof this.service === 'undefined') {
            Log(`add service [${device.id}:${this.id}]`);
            this.service = device.accessory.addService(Service.StatelessProgrammableSwitch, `${device.name} ${this.name}`, this.name);
        }

        this.service.addOptionalCharacteristic(Characteristic.ConfiguredName);
        this.service.setCharacteristic(Characteristic.ConfiguredName, this.name);

        // Configure to handle only single press
        if (this.singlePressOnly) {
            this.service
                .getCharacteristic(Characteristic.ProgrammableSwitchEvent)
                .setProps({ validValues: [0] })
                .setProps({ maxValue: 0 });
        } else {
            this.service
                .getCharacteristic(Characteristic.ProgrammableSwitchEvent)
                .setProps({ validValues: [0, 1, 2] })
                .setProps({ maxValue: 2 });
        }

        // State machine for handling events
        this.stateMachine = new StateMachine();
        this.stateMachine.create(StateMachineConfig);

        // State listeners - adding specific listeners to individual states
        // doesn't seem to function correctly (callbacks don't receive
        // expected params).
        this.stateMachine.onChange.add(function(state, data, action) {
            let prevState = this.stateMachine.previousState ? this.stateMachine.previousState.name : '()';
            Log(`[${this.device.id}:${this.id}] ${action}: ${prevState} --> ${state.name} (${this.device.name}::${this.name})`);
        }.bind(this));

        this.stateMachine.onEnter.add(function(state, data, action) {
            // Log(`ENTER: state=${state.name} action=${action}`);

            switch (state.name) {
                case State.IDLE:
                    this.stateIdleEnter(action);
                    break;

                case State.FIRST_PRESS:
                    this.stateFirstPressEnter(action);
                    break;

                case State.WAIT_SINGLE_TIMEOUT:
                    this.stateWaitSingleTimeoutEnter(action);
                    break;
                    
                case State.WAIT_RELEASE:
                    this.stateWaitReleaseEnter(action);
                    break;
                
                default:
                    Log(`ENTER UNHANDLED STATE: ${state.name}`);
                    break;
            }
        }.bind(this));

        this.stateMachine.onExit.add(function(state, data, action) {
            // Log(`EXIT: state=${state.name} action=${action}`);

            switch (state.name) {
                case State.IDLE:
                    this.stateIdleExit(action);
                    break;

                case State.FIRST_PRESS:
                    this.stateFirstPressExit(action);
                    break;

                case State.WAIT_SINGLE_TIMEOUT:
                    this.stateWaitSingleTimeoutExit(action);
                    break;

                case State.WAIT_RELEASE:
                    this.stateWaitReleaseExit(action);
                    break;

                default:
                    Log(`EXIT UNHANDLED STATE: ${state.name}`);
                    break;
            }
        }.bind(this));

        // Start the machine!
        this.stateMachine.start();
    }

    //
    // Handlers for IDLE state
    //

    stateIdleEnter(action) {
    }

    stateIdleExit(action) {
    }

    //
    // Handlers for FIRST_PRESS state
    //

    stateFirstPressEnter(action) {
        if (this.singlePressOnly) {
            this.stateMachine.action(Action.SINGLE_ONLY);
        } else {
            this.timer2 = setTimeout(function() {
                this.stateMachine.action(Action.TIMEOUT_LONG);
            }.bind(this), this.longTimeout);
        }
    }

    stateFirstPressExit(action) {
        switch (action) {
            case Action.RELEASE:
                clearTimeout(this.timer2);
                this.timer2 = null;
                break;

            case Action.TIMEOUT_LONG:
                Log('SEND: Long Press');
                this.service.updateCharacteristic(Characteristic.ProgrammableSwitchEvent, Characteristic.ProgrammableSwitchEvent.LONG_PRESS);
                break;

            case Action.SINGLE_ONLY:
                Log('SEND: Single Press');
                this.service.updateCharacteristic(Characteristic.ProgrammableSwitchEvent, Characteristic.ProgrammableSwitchEvent.SINGLE_PRESS);
                break;
        }
    }

    //
    // Handlers for WAIT_SINGLE_TIMEOUT state
    //

    stateWaitSingleTimeoutEnter(action) {
        this.timer1 = setTimeout(function() {
            this.stateMachine.action(Action.TIMEOUT_SINGLE);
        }.bind(this), this.pressTimeout);
    }

    stateWaitSingleTimeoutExit(action) {
        switch (action) {
            case Action.TIMEOUT_SINGLE:
                Log('SEND: Single Press');
                this.service.updateCharacteristic(Characteristic.ProgrammableSwitchEvent, Characteristic.ProgrammableSwitchEvent.SINGLE_PRESS);
                break;

            case Action.PRESS:
                Log('SEND: Double Press');
                this.service.updateCharacteristic(Characteristic.ProgrammableSwitchEvent, Characteristic.ProgrammableSwitchEvent.DOUBLE_PRESS);
                clearTimeout(this.timer1);
                this.timer1 = null;
                break;
        }
    }

    //
    // Handlers for WAIT_RELEASE state
    //

    stateWaitReleaseEnter(action) {
    }

    stateWaitReleaseExit(action) {
    }

    //
    // Handle button event. Convert to appropriate state machine event/action.
    //
    event(actionNumber) {
        // Handle this button event if it not an ignored button
        if (this.ignore === true) { return; }

        switch (actionNumber) {
            case 3: // PRESS
                this.stateMachine.action(Action.PRESS);
                break;

            case 4: // RELEASE
                this.stateMachine.action(Action.RELEASE);
                break;

            default:
                Log(`RCV UNKNOWN: \'[${this.device.id}:${this.id}\]' - (${this.name}) - |${actionNumber}|`);
                break;
        }
    }
}

module.exports = Button;
