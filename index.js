"use strict";

////////////////////////////////////////////////////////////////////////////////
//
// LUTRON RA2 SELECT
//
// A Homebridge plugin to surface Pico remotes for HomeKit control.
//
// Pico remotes are connect to the Lutron RA2 Select bridge. These
// remotes are not normally available externally.
//
// See:
// https://www.lutron.com/en-US/Products/Pages/WholeHomeSystems/RA2Select/Overview.aspx
// https://github.com/homebridge/homebridge
//
// Additional device support can added by extending the 'Device' class
// using the existing pattern and adding the appropriate hooks in the
// 'Factory' class.
//
////////////////////////////////////////////////////////////////////////////////

const { Telnet } = require('telnet-client')

// GLOBALS - rather than passing them around (readonly)
global.Homebridge = null;
global.Accessory = null;
global.Service = null;
global.Characteristic = null;
global.UUIDGen = null;
global.Log = null;

module.exports = function(homebridge) {
    Homebridge = homebridge;
    Accessory = Homebridge.platformAccessory;
    Service = Homebridge.hap.Service;
    Characteristic = Homebridge.hap.Characteristic;
    UUIDGen = Homebridge.hap.uuid;

    Homebridge.registerPlatform('homebridge-ra2-select', 'RA2Select', RA2Select, true);
}

class RA2Select {

    //
    // Constructor.
    //
    constructor(log, config, api) {
        Log = log;

        // Read config params
        this.username = config['username'];
        this.password = config['password'];
        this.host     = config['host'];
        this.devices  = config['devices'];

        Log('Loaded config');

        this.api = api;
        this.discoveries = {};

        // Listen for launch completion
        var platform = this;
        api.on('didFinishLaunching', function() {
            platform.didFinishLaunching();
        });
    }

    // Called by Homebridge during startup. Invoked for each accessory
    // that has been cached from a previous session. Cached accessories
    // must not be recreated from scratch. Here we simply keep track
    // of the discovered accessories. We'll use them later during the
    // device configuration stage.
    configureAccessory(accessory) {
        Log(`Configure Accessory: ${accessory.displayName} [${accessory.UUID}]`);

        // track that we've seen this accessory
        this.discoveries[accessory.UUID] = accessory;
        accessory.reachable = false;
    }

    // Called by Homebridge during startup after cached accessories
    // have been discovered.
    didFinishLaunching() {
        Log('Did Finish Launching...');

        // Configure devices
        this.configureDevices();

        // Establish a telnet connection to the RA2 bridge
        this.connection = this.createConnection();
    }

    // Configure and connect to the RA2 bridge via telnet
    createConnection() {
        Log('Creating telnet connection...');

        const params = {
            host: this.host,
            username: this.username,
            password: this.password,
            loginPrompt: 'login: ',
            passwordPrompt: 'password: ',
            shellPrompt: 'GNET> '
        }

        let connection = new Telnet();

        connection.on('connect', () => {
            Log('RCV CONNECT');
        })

        connection.on('ready', prompt => {
            Log(`RCV READY. PROMPT: ${prompt}`);
        });

        connection.on('data', buffer => {
            this.processReceivedData(buffer);
        });

        connection.on('timeout', () => {
            Log('RCV TIMEOUT');
        });

        connection.on('failedlogin', () => {
            Log('RCV FAILEDLOGIN');
        })

        connection.on('error', () => {
            Log('RCV ERROR');
        })

        connection.on('end', () => {
            Log('RCV END');
        })

        connection.on('close', () => {
            Log('RCV CLOSE');
        });

        connection.connect(params);

        return connection;
    }

    // Process data received from the RA2 unit.
    processReceivedData(buffer) {
        const cmd = buffer.toString().split(',');

        // Received a DEVICE event. Parse the data into component pieces
        // and handle if this a know button.
        if (cmd[0] === '~DEVICE') {
            const deviceId = parseInt(cmd[1]);
            const buttonId = parseInt(cmd[2]);
            const actionNumber= parseInt(cmd[3]);

            // Do we know about this device?
            const device = this.devices.find(({id}) => id === deviceId);
            if (device) {
                // Not an ignored device, look for button definition
                if (typeof device.ignore === 'undefined' || device.ignore === false) {
                    // Do we know about this button?
                    const button = device.buttons.find(({id}) => id === buttonId);
                    if (button) {
                        // Handle this button press if it not an ignored button
                        if (typeof button.ignore === 'undefined' || button.ignore === false) {
                            this.handleButtonPress(device, button, actionNumber);
                        }
                    } else {
                        Log(`RCV UNK: deviceId=${deviceId}, buttonId=${buttonId}, actionNumber=${actionNumber}`);
                    }
                }
            } else {
                Log(`RCV UNK: deviceId=${deviceId}, buttonId=${buttonId}, actionNumber=${actionNumber}`);
            }
        }
    }

    handleButtonPress(device, button, actionNumber) {
        // PRESS
        if (actionNumber === 3) {
            Log(`RCV PRESS: \'[${device.id}:${button.id}\]' - (${button.name})`);
            let service = button.accessory.getService(Service.StatelessProgrammableSwitch);
            service.updateCharacteristic(Characteristic.ProgrammableSwitchEvent, Characteristic.ProgrammableSwitchEvent.SINGLE_PRESS);
        }

        // RELEASE
        else if (actionNumber === 4) {
            Log(`RCV RELEASE: \'[${device.id}:${button.id}\]' - (${button.name})`);
        }

        // ????
        else {
            Log(`RCV UNKNOWN: \'[${device.id}:${button.id}\]' - (${button.name}) - |${actionNumber}|`);
        }
    }

    configureDevices() {
        Log('Configure devices...');

        // No devices configured
        if (typeof this.devices === 'undefined') {
            Log('No devices configured');
            return;
        }

        // Loop through devices
        for (let i=0; i<this.devices.length; i++) {
            let device = this.devices[i];

            if (device.ignore === true) {
                Log(`Ignoring device ${device.id}`);
                continue;
            }

            if (typeof device.buttons === 'undefined') {
                Log(`No buttons configured for device ${device.id}`);
                continue;
            }

            this.configureDevice(device);
        }
    }

    configureDevice(device) {
        for (let i=0; i<device.buttons.length; i++) {
            let button = device.buttons[i];

            if (button.ignore === true) {
                Log(`Ignoring device ${device.id}, button ${button.id}`);
                continue;
            }

            this.configureButton(device, button);
        }
    }

    configureButton(device, button) {
        Log(`Found device ${device.id}, button ${button.id}`);

        // Create a unique name for creating the UUID
        let uuidName = `${device.name}-${device.id}-${button.name}-${button.id}`
        let uuid = UUIDGen.generate(uuidName);

        
        let discovered = this.discoveries[uuid];

        var accessory;
        if (discovered) {
            Log(`Existing: ${device.id}:${button.id} [${uuid}]`);
            accessory = discovered;
        } else {
            Log(`Create: ${device.id}:${button.id} [${uuid}]`);
            accessory = new Accessory(button.name, uuid);
        }
        button.accessory = accessory;

        accessory.on('identify', () => {
            Log(`***** IDENTIFY: ${device.id}:${button.id}`);
        });

        // Add services
        if (typeof discovered === 'undefined') {
            Log('add service');
            accessory.addService(Service.StatelessProgrammableSwitch, button.name);
        }

        // let service = accessory.getService(Service.StatelessProgrammableSwitch);

        // // Add characteristics
        // service
        //     .getCharacteristic(Characteristic.ProgrammableSwitchEvent)
        //     .on('get', (callback) => {
        //         Log(`get state: ${device.id}:${button.id}`);
        //         callback(null, Characteristic.ProgrammableSwitchEvent.SINGLE_PRESS);
        //     });

        // Add general accessory information
        accessory
            .getService(Service.AccessoryInformation)
            .updateCharacteristic(Characteristic.Manufacturer, 'Lutron')
            .updateCharacteristic(Characteristic.Model, 'Pico')
            .updateCharacteristic(Characteristic.Name, `${button.name}`)
            .updateCharacteristic(Characteristic.SerialNumber, `${uuid}`);

        if (discovered) {
            accessory.reachable = true;
        } else {
            Log(`register accessory: ${accessory.displayName}`);
            this.api.registerPlatformAccessories("homebridge-ra2-select", "RA2Select", [accessory]);
        }
    }
}
