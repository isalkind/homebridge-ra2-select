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
// https://www.lutron.com/TechnicalDocumentLibrary/040249.pdf (see: Pico Wireless Control)
// https://github.com/homebridge/homebridge
//
////////////////////////////////////////////////////////////////////////////////

const { Telnet } = require('telnet-client')

const pluginName = 'homebridge-ra2-select';
const platformName = 'RA2Select';

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

    Homebridge.registerPlatform(pluginName, platformName, RA2Select, true);
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
        this.existingDevices = {};

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
        this.existingDevices[accessory.UUID] = accessory;
        accessory.reachable = false;
    }

    // Called by Homebridge during startup after cached accessories
    // have been discovered.
    async didFinishLaunching() {
        Log('Did Finish Launching...');

        // Configure devices
        this.configureDevices();

        // Establish a telnet connection to the RA2 bridge
        this.connection = await this.createConnection();
    }

    // Configure and connect to the RA2 bridge via telnet
    async createConnection() {
        Log('Creating telnet connection...');

        const params = {
            host:           this.host,
            username:       this.username,
            password:       this.password,
            loginPrompt:    'login: ',
            passwordPrompt: 'password: ',
            shellPrompt:    'GNET> '
        }

        let connection = new Telnet();

        connection.on('connect', () => {
            Log('RCV CONNECT');
        })

        connection.on('ready', prompt => {
            Log(`RCV READY. PROMPT: ${prompt}`);
        });

        // Data received from the bridge
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

        // Connection has closed, must be reopened
        connection.on('close', async () => {
            Log('RCV CLOSE: reopening...');

            // Re-establish a telnet connection to the RA2 bridge
            await this.connection.destroy();
            this.connection = await this.createConnection();
        });

        await connection.connect(params);

        return connection;
    }

    // Process data received from the RA2 unit.
    processReceivedData(buffer) {
        const cmd = buffer.toString().split(',');

        // Received a DEVICE event. Parse the data into component pieces
        // and handle if this a known button.
        if (cmd[0] === '~DEVICE' && cmd.length === 4) {
            const deviceId = parseInt(cmd[1]);
            const buttonId = parseInt(cmd[2]);
            const actionNumber= parseInt(cmd[3]);

            // Do we know about this device?
            const device = this.devices.find(({id}) => id === deviceId);
            if (device) {
                // Not an ignored device, look for button definition
                if ((typeof device.ignore === 'undefined' || device.ignore === false) && device.buttons) {
                    // Do we know about this button?
                    const button = device.buttons.find(({id}) => id === buttonId);
                    if (button) {
                        // Handle this button event if it not an ignored button
                        if (typeof button.ignore === 'undefined' || button.ignore === false) {
                            this.handleButtonEvent(device, button, actionNumber);
                        }
                    } else {
                        Log(`RCV UNK: deviceId=${deviceId}, buttonId=${buttonId}, actionNumber=${actionNumber}`);
                    }
                } else {
                    Log(`RCV UNK: deviceId=${deviceId}, buttonId=${buttonId}, actionNumber=${actionNumber}`);
                }
            } else {
                Log(`RCV UNK: deviceId=${deviceId}, buttonId=${buttonId}, actionNumber=${actionNumber}`);
            }
        }
    }

    handleButtonEvent(device, button, actionNumber) {
        // PRESS
        if (actionNumber === 3) {
            Log(`RCV PRESS: \'[${device.id}:${button.id}\]' - (${button.name})`);
            button.service.updateCharacteristic(Characteristic.ProgrammableSwitchEvent, Characteristic.ProgrammableSwitchEvent.SINGLE_PRESS);
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

            if (typeof device.id === 'undefined') {
                Log(`***** Device id MUST be configured`);
                continue;
            }

            if (device.ignore === true) {
                Log(`Ignoring device ${device.id}`);
                continue;
            }

            if (typeof device.name === 'undefined') {
                Log(`***** Name MUST be configured for ${device.id} if not ignored`);
                continue;
            }

            if (typeof device.buttons === 'undefined') {
                Log(`***** No buttons configured for device ${device.id}, ignoring`);
                continue;
            }

            this.configureDevice(device);
        }

        // Remove any previously cached devices we haven't recovered
        for (var uuid in this.existingDevices) {
            let accessory = this.existingDevices[uuid];
            if (accessory) {
                Log(`Deregister Accessory: ${accessory.displayName} [${accessory.UUID}]`);
                this.api.unregisterPlatformAccessories(pluginName, platformName, [accessory]);
            }
        }
    }

    configureDevice(device) {
        // Create a unique name for creating the UUID
        let uuidName = `${device.name}-${device.id}`
        let uuid = UUIDGen.generate(uuidName);

        let discovered = this.existingDevices[uuid];

        var accessory;
        if (discovered) {
            Log(`Existing: ${device.name} [${device.id}] [${uuid}]`);
            accessory = discovered;
            delete this.existingDevices[uuid];
        } else {
            Log(`Create: ${device.name} [${device.id}] [${uuid}]`);
            accessory = new Accessory(device.name, uuid);
        }
        device.accessory = accessory;
        
        accessory.on('identify', () => {
            Log(`***** IDENTIFY: ${device.name} [${device.id}]`);
        });

        // Configure buttons
        for (let i=0; i<device.buttons.length; i++) {
            let button = device.buttons[i];

            if (typeof button.id === 'undefined') {
                Log(`***** Ignore device ${device.id} button, button id MUST be configured`);
                continue;
            }

            if (button.ignore === true) {
                Log(`Ignoring device ${device.id}, button ${button.id}`);
                continue;
            }

            if (typeof button.name === 'undefined') {
                Log(`***** Ignore device ${device.id} button ${button.id}, name MUST be configured if not ignored`);
                continue;
            }

            // Add service if it does not already exist
            button.service = accessory.getServiceById(Service.StatelessProgrammableSwitch, button.name);
            if (typeof button.service === 'undefined') {
                Log(`add service [${device.id}:${button.id}]`);
                button.service = accessory.addService(Service.StatelessProgrammableSwitch, `${device.name} ${button.name}`, button.name);
            }

            // Only single press available for now. Remove double press (1)
            // and long press (2)
            button.service
                .getCharacteristic(Characteristic.ProgrammableSwitchEvent)
                .setProps({ validValues: [0] })
                .setProps({ maxValue: 0 });
        }

        // Add general accessory information
        accessory
            .getService(Service.AccessoryInformation)
            .updateCharacteristic(Characteristic.Manufacturer, 'Lutron')
            .updateCharacteristic(Characteristic.Model, 'Pico')
            .updateCharacteristic(Characteristic.Name, `${device.name}`)
            .updateCharacteristic(Characteristic.SerialNumber, `${uuid}`);

        if (discovered) {
            accessory.reachable = true;
        } else {
            Log(`register accessory: ${accessory.displayName}`);
            this.api.registerPlatformAccessories(pluginName, platformName, [accessory]);
        }
    }
}
