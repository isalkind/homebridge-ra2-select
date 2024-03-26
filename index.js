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

const { Telnet } = require('telnet-client');
const Pico = require('./Pico');

const pluginName = 'homebridge-ra2-select';
const platformName = 'RA2Select';

// GLOBALS - rather than passing them around (readonly)
global.Homebridge = null;
global.Accessory = null;
global.Service = null;
global.Characteristic = null;
global.UUIDGen = null;
global.Log = null;
global.LogDetail = null;
global.Config = null;
global.ExistingDevices = null;

module.exports = function(homebridge) {
    Homebridge = homebridge;
    Accessory = Homebridge.platformAccessory;
    Service = Homebridge.hap.Service;
    Characteristic = Homebridge.hap.Characteristic;
    UUIDGen = Homebridge.hap.uuid;

    Homebridge.registerPlatform(pluginName, platformName, RA2Select, true);
}

function logDetail(log, msg) {
    if (log) {
        Log(msg);
    }
}

class RA2Select {

    //
    // Constructor.
    //
    constructor(log, config, api) {
        Log = log;
        LogDetail = logDetail;
        Config = config;
        ExistingDevices = {};

        // Read config params
        this.username = config['username'];
        this.password = config['password'];
        this.host     = config['host'];
        this.devices  = config['devices'];

        // Check for required values
        if (typeof this.host === 'undefined' ||
            typeof this.username === 'undefined' ||
            typeof this.password === 'undefined') {
            Log.warn('**********');
            Log.warn('*** Check configuration. These values must be defined in config.json:');
            Log.warn(`*** \thost     - RA2 Select hostname / IP address [${this.host}]`);
            Log.warn(`*** \tusername - RA2 Select username [${this.username}]`);
            Log.warn(`*** \tpassword - RA2 Select password [${this.password}]`);
            Log.warn('**********');
            return;
        }

        Log('Loaded config');

        this.api = api;
        this.picos = [];

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
        ExistingDevices[accessory.UUID] = accessory;
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
            Log('RCV CLOSE');

            // Re-establish a telnet connection to the RA2 bridge
            if (this.connection) {
                Log('reopening...');
                await this.connection.destroy();
                this.connection = await this.createConnection();
            }
        });

        try {
            await connection.connect(params);
        } catch (error) {
            Log.warn(`CONNECT ERROR: name:${error.name} message:${error.message}`);
            connection.destroy();
            connection = null;

            Log.warn('**********');
            Log.warn('*** Check configuration and connectivity:');

            if (error.message.startsWith('getaddrinfo ENOTFOUND')) {
                Log.warn(`*** \tCHECK HOST: \'${this.host}\' appears to be an unknown host.`);
            } else if (error.message.startsWith('connect ECONNREFUSED')) {
                Log.warn(`*** \tCHECK HOST CONFIG: Telnet must be enabled on \'${this.host}\'. See documentation.`);
            } else if (error.message === 'Cannot connect') {
                Log.warn(`*** \tCHECK HOST: Is \'${this.host}\' a valid host?`);
                Log.warn(`*** \tCHECK USERNAME/PASSWORD: Is \'${this.username}\'/\'${this.password}\' correct?`);
            } else {
                Log.warn(`*** \tUNKNOWN ERROR. Check configuration values.`);
            }

            Log.warn('**********');
        }

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
            const device = this.picos.find(({id}) => id === deviceId);
            if (device) {
                device.event(buttonId, actionNumber);
            } else {
                Log(`RCV UNK: deviceId=${deviceId}, buttonId=${buttonId}, actionNumber=${actionNumber}`);
            }
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

            try {
                let pico = new Pico(this.api, device);
                this.picos.push(pico);
                Log(`Created Pico: id=${pico.id}, ignore=${pico.ignore}`);
            } catch (e) {
                Log(`FAILED TO CREATE PICO: ${e}`);
            }
        }

        // Remove any previously cached devices we haven't recovered
        for (var uuid in ExistingDevices) {
            let accessory = ExistingDevices[uuid];
            if (accessory) {
                Log(`Deregister Accessory: ${accessory.displayName} [${accessory.UUID}]`);
                this.api.unregisterPlatformAccessories(pluginName, platformName, [accessory]);
            }
        }
    }
}
