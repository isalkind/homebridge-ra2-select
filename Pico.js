"use strict";

////////////////////////////////////////////////////////////////////////////////
//
// Pico
//
////////////////////////////////////////////////////////////////////////////////

const Button = require('./Button');

class Pico {

    //
    // Constructor
    //
    constructor(api, deviceConfig) {
        // Check for device id
        if (typeof deviceConfig.id === 'undefined') {
            throw new Error('***** Device id MUST be configured');
        }

        this.id = deviceConfig.id;
        this.ignore = false;
        this.logging = deviceConfig.logging || false;
        this.buttons = [];

        // Ignored device
        if (deviceConfig.ignore === true) {
            LogDetail(this.logging, `Ignoring device ${deviceConfig.id}`);
            this.ignore = true;
            return;
        }

        // Check for device name
        if (typeof deviceConfig.name === 'undefined') {
            throw new Error(`***** Name MUST be configured for device.id=${deviceConfig.id} if not ignored`);
        }

        this.name = deviceConfig.name;

        // Check for buttons
        if (typeof deviceConfig.buttons === 'undefined') {
            LogDetail(this.logging, `***** No buttons configured for device ${deviceConfig.id}, ignoring`);
            this.ignore = true;
            return;
        }

        this.singlePressOnly = deviceConfig.singlePressOnly || false;

        // Passed initial sanity checks
        this.configure(api, deviceConfig);
    }

    //
    // Complete configuraiton of the device. Sanity checks complete.
    //
    configure(api, deviceConfig) {
        // Create a unique name for creating the UUID
        let uuidName = `${this.name}-${this.id}`
        let uuid = UUIDGen.generate(uuidName);

        let discovered = ExistingDevices[uuid];

        var accessory;
        if (discovered) {
            LogDetail(this.logging, `Existing: ${this.name} [${this.id}] [${uuid}]`);
            accessory = discovered;
            delete ExistingDevices[uuid];
        } else {
            LogDetail(this.logging, `Create: ${this.name} [${this.id}] [${uuid}]`);
            accessory = new Accessory(this.name, uuid);
        }
        this.accessory = accessory;
        
        accessory.on('identify', () => {
            Log(`***** IDENTIFY: ${this.name} [${this.id}]`);
        });

        // Configure buttons
        for (let i=0; i<deviceConfig.buttons.length; i++) {
            let button = new Button(this, deviceConfig.buttons[i]);
            this.buttons.push(button);
        }

        // Add general accessory information
        accessory
            .getService(Service.AccessoryInformation)
            .updateCharacteristic(Characteristic.Manufacturer, 'Lutron')
            .updateCharacteristic(Characteristic.Model, 'Pico')
            .updateCharacteristic(Characteristic.Name, `${this.name}`)
            .updateCharacteristic(Characteristic.SerialNumber, `${uuid}`);

        if (discovered) {
            accessory.reachable = true;
        } else {
            LogDetail(this.logging, `register accessory: ${accessory.displayName}`);
            api.registerPlatformAccessories(pluginName, platformName, [accessory]);
        }
    }

    //
    // Handle button event
    //
    event(buttonId, actionNumber) {
        // Handle event if not an ignored device
        if (this.ignore) { return; }

        // Do we know about this button?
        const button = this.buttons.find(({id}) => id === buttonId);
        if (button) {
            button.event(actionNumber);
        } else {
            LogDetail(this.logging, `RCV UNK BUTTON: deviceId=${this.id}, buttonId=${buttonId}, actionNumber=${actionNumber}`);
        }
    }
}

module.exports = Pico;
