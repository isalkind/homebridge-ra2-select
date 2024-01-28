# homebridge-ra2-select

A [Homebridge](https://homebridge.io) plugin for [**Lutron RA2 Select**](https://www.lutron.com/en-US/Products/Pages/WholeHomeSystems/RA2Select/Overview.aspx) devices. This plugin **does not** provide support for Lutron Radio RA2 devices.

This plugin currently has one purpose: allow [**Lutron Pico remotes**](https://www.lutron.com/en-US/Products/Pages/Components/PicoWirelessController/Overview.aspx) to control HomeKit devices outside of the Lutron ecosystem.

## Required Hardware

* [RA2 Select](https://www.lutron.com/en-US/Products/Pages/WholeHomeSystems/RA2Select/Overview.aspx)
* [Pico remote(s) compatible with the RA2 Select](https://www.lutron.com/en-US/Products/Pages/WholeHomeSystems/RA2Select/Components.aspx)

### Supported Hardware

The following hardware has been confirmed to work with this plugin:

* RA2 Select [RR-SEL-REP2]
* Two Button Pico Remote [PJ2-2B]
* Three Button Pico Remote w/ raise/lower [PJ2-3BRL]
* *Let me know what Picos you've had success with!*

It is expected that any other Pico remote that is identified as being compatible with the RA2 Select will also work without issue.

### Other Bridges

> It is possible that this plugin may work with other Lutron bridges besides just the RA2 Select, but it has not been tested, nor will it be supported.

## Supported Features

Pico remotes are surfaced in HomeKit as Stateless Programable Switches with buttons that provide single, double, and long press support.

## Installation

For the best experience installing this plugin, please use [homebridge-config-ui-x](https://www.npmjs.com/package/homebridge-config-ui-x).

Manual Install:

```sh
npm -g install homebridge-ra2-select
```

## Ready Your Hardware

Configuration of your hardware requires the [Lutron App](https://apps.apple.com/us/app/lutron-app/id886753021).

### Add the RA2 Select as a Hub/Bridge

Follow the manufacturer's instructions to add the bridge to your HomeKit setup if necessary.

### Enable Telnet

This plugin uses Telnet to communicate with the RA2 Select devices. By default, the RA2 Select has Telnet access disabled. To enable access:

`Lutron App / Settings / Advanced / Integration / Telnet Support` --> Toggle on.

### Add a New Pico

`Lutron App / Settings / Add Device` --> Follow the instructions. Do not associate the Pico with any existing lutron devices.

### Use an Existing Pico

Disassociate the existing Pico from controlling Lutron devices directly:

`Lutron App / <Existing Pico> / Edit Device / Devices` --> Unselect all devices

## Configuration

Start with the starter config. You will use this simple configuration to identify the device and button information needed to complete the configuration. See the [Identifying Device and Button Ids](#identifying-device-and-button-ids) section below.

Ex: config.json - Starter config - replace values as appropriate

```json
{
    "platform": "RA2Select",
    "host": "192.168.0.12",
    "username": "user",
    "password": "secret"
}
```

Once you have identified the device and button information, you will now complete the configuration to expose the Pico remotes to HomeKit.

Ex: config.json - After device and button discovery

* Two Pico remotes identified (Ids 11, 14)
* One Pico remote (Id 11) has two buttons (Ids 2, 4)
* One Pico remote (Id 14) ignored

```json
{
    "platform": "RA2Select",
    "host": "192.168.0.12",
    "username": "user",
    "password": "secret"
    "devices": [
        {
            "id": 11,
            "name": "Bathroom Pico",
            "buttons": [
                {
                    "id": 2,
                    "name": "On"
                },
                {
                    "id": 4,
                    "name": "Off"
                }
            ]
        },
        {
            "id": 14,
            "ignore": true
        }
    ]
}
```

### Parameters

| Param         | Description   | Required  |
| ------------- | ------------- | -------- |
| platform | **Must be set to "RA2Select"** | yes |
| host | The IP address or hostname of the RA2 Select | yes |
| username | RA2 Select username. The default setting for the RA2 Select is `lutron`. | yes |
| password | RA2 Select password. The default setting for the RA2 Select is `integration` | yes |
| devices | Array of devices (Pico remotes). See [Devices](#devices) section. |
| pressTimeout | Timeout after first press before recognizing it as a single press, i.e., second press must be received within this interval to be considered a double-press event. In millis.<br><br>Defaults to 500. | no |
| longTimeout | Timeout before a single press becomes a long press. If a release event is not received before this interval expires, then it is a long press. In millis.<br><br>Defaults to 2000. | no |

#### Devices

| Param         | Description   | Required  |
| ------------- | ------------- | -------- |
| id | Device identifier of the Pico remote | yes |
| ignore | Ignore this device (true/false). An ignored device is excluded from logging and HomeKit exposure.<br><br>Defaults to false. | no |
| name | Assigned device name. If 'ignore' is true, then this parameter is not required. If 'ignore' is false, then this parameter is required and becomes the name of the Stateless Programable Switch exposed to HomeKit. | if `ignore` is false |
| buttons | Array of buttons. See [Buttons](#buttons) section. | no |
| logging | Output detailed log information (true/false) for this device (and any of its buttons).<br><br>Defaults to false. | no |
| singlePressOnly | All buttons on the device are configured to be single press only buttons and will imediately respond to a press without delay.<br><br>Defaults to false. | no |

#### Buttons

| Param         | Description   | Required  |
| ------------- | ------------- | -------- |
| id | Button identifier of Pico remote button | yes |
| ignore | Ignore this button (true/false). An ignored button is excluded from logging and HomeKit exposure.<br><br>Defaults to false. | no |
| name | Assigned button name. If 'ignore' is true, then this parameter is not required. If 'ignore' is false, then this parameter is required and becomes the name of a button associated with the Stateless Programable Switch exposed to HomeKit.<br><br>Note: The Home app does not expose the names of the buttons, which simply show up as "Button 1", "Button 2", etc. in no particular order. Other apps (ex: Eve) expose the button names. | if `ignore` is false |
| singlePressOnly | The buttons is configured to be a single press only button and will immediately respond to a press without delay.<br><br>Defaults to false. | no |

## Identifying Device and Button Ids

Pico remotes that are not configured must be identified by looking in the Homebridge log file. Unconfigured remotes can happen when you first start up this plugin, or when adding a new device.

To identify a remote and its buttons:

1. Press a button on the remote.
2. Examine the log file to find the device and button identities.

   You are looking for entries like this:

   ```text
   RCV UNK: deviceId=8, buttonId=3, actionNumber=3
   ```

   This indicates that a button was pressed on a device identified as `8` and the button is identified as `3`.

3. Repeat steps 1 & 2 for each button on the remote, unless this is a remote you want to ignore.

   *Note: each button of a single remote will have the same device identifier.*

### Why would I want to ignore a Pico remote?

If you have pre-existing remotes controlling devices within your Lutron ecosystem, you may not want to expose them in HomeKit as new devices. For example, I have a number Pico devices that control my Lutron shades. I do not want to use those Picos for anything else. By ignoring those Picos, I will also cut down on the noise in the Homebridge log file. On the other hand, if I want to piggy-back on button presses from those remotes, then I could do that by adding them to the configuration.

### Why would I want to ignore a Pico button?

Again, this is mainly about cutting down noise in the Homebridge log file. I may have some buttons on my remotes I am not currently using, don't wish to expose to HomeKit, and don't want the presses to be logged.

## Configure Remotes in HomeKit

You are ready to configure your new switches in homekit once you have identified the remotes and buttons, configured the plugin appropriately, and restarted homebridge.

Each remote that you configured in homebridge is exposed as a Stateless Programmable Switch in HomeKit. You can use either the `Home` app or another HomeKit compatible app such as the `Eve` app.
