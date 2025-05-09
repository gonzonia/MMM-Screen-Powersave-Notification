/* MagicMirror²
 * Module: Screen-Powersave-Notification
 *
 * By Tom Hirschberger
 * MIT Licensed.
 */
const NodeHelper = require('node_helper')
const spawn = require('child_process').spawn
const spawnSync = require('child_process').spawnSync
const fs = require('fs')
const path = require('path')
const Log = require("logger");
const callbackDir = path.join(__dirname, '/callbackScripts')

module.exports = NodeHelper.create({

  start: function () {
    this.started = false
    this.forcedDown = false
    this.currentProfile = ''
    this.currentProfilePattern = new RegExp('.*')
    this.modulesHidden  = false
    this.skipNextProfileChange= false
  },

  Sleep: function (milliseconds) {
    return new Promise(resolve => setTimeout(resolve, milliseconds));
  },

  isScreenOn: function () {
    if(this.config.hideInsteadShutoff){
      if(this.modulesHidden){
        return false
      } else {
        return true
      }
    } else {
      const self = this
      if (self.config.screenStatusCommand !== '') {
        let spawnOutput = spawnSync(this.config.screenStatusCommand, this.config.screenStatusArgs)
        result = spawnOutput.stdout
        if (result != null){
          result = result.toString().trim()
        } else {
          result = ""
        }

        if (spawnOutput.stderr != null){
          let error = spawnOutput.stderr.toString().trim()
          if (error != ""){
            Log.log(self.name + ': Error during screen status check: ')
            Log.log(spawnOutput.stderr.toString())
          }
        }

        if (result.indexOf('display_power=0') === 0) {
          return false
        } else {
          return true
        }
      }
      return false
    }
  },

  turnScreenOff: async function (forced) {
    const self = this
    if (self.config.changeToProfileBeforeAction !== null) {
      self.skipNextProfileChange = true
      self.sendSocketNotification("CURRENT_PROFILE", self.config.changeToProfileBeforeAction)
      await self.Sleep(500)
    }
    if (self.isScreenOn()){
      if (forced === true) {
        Log.log(self.name + ': Turning screen off (forced)!')
        self.forcedDown = true
      } else {
        Log.log(self.name + ': Turning screen off!')
        self.forcedDown = false
      }
      if(self.config.hideInsteadShutoff){
        self.sendSocketNotification("SCREEN_HIDE_MODULES")
        self.modulesHidden = true
      } else {
        if (self.config.screenOffCommand !== '') {
          let spawnOutput = spawnSync(this.config.screenOffCommand, this.config.screenOffArgs)
          if (spawnOutput.stderr != null){
            let error = spawnOutput.stderr.toString().trim()
            if (error != ""){
              Log.log(self.name + ': Error during screen off command: ')
              Log.log(spawnOutput.stderr.toString())
            }
          }
        }
      }
      self.runScriptsInDirectory(callbackDir + '/off')

      self.sendSocketNotification("SCREENSAVE_ENABLED")
    } else {
      if( self.forcedDown === false ){
        self.forcedDown = forced
      }
    }
  },

  turnScreenOn: function (forced) {
    const self = this
    if ( self.isScreenOn() === false ){
      if (forced === true) {
        Log.log(self.name + ': Turning screen on (forced)!')
        if(self.config.hideInsteadShutoff){
          self.sendSocketNotification("SCREEN_SHOW_MODULES")
          self.modulesHidden = false
        } else {
          if (self.config.screenOnCommand !== '') {
            let spawnOutput = spawnSync(this.config.screenOnCommand, this.config.screenOnArgs)
            if (spawnOutput.stderr != null){
              let error = spawnOutput.stderr.toString().trim()
              if (error != ""){
                Log.log(self.name + ': Error during screen on command: ')
                Log.log(spawnOutput.stderr.toString())
              }
            }
          }
        }
        self.forcedDown = false
        self.runScriptsInDirectory(callbackDir + '/on')
        self.sendSocketNotification("SCREENSAVE_DISABLED")
      } else {
        if (self.forcedDown === false) {
          Log.log(self.name + ': Turning screen on!')
          if(self.config.hideInsteadShutoff){
            self.sendSocketNotification("SCREEN_SHOW_MODULES")
            self.modulesHidden = false
          } else {
            if (self.config.screenOnCommand !== '') {
              let spawnOutput = spawnSync(this.config.screenOnCommand, this.config.screenOnArgs)
              if (spawnOutput.stderr != null){
                let error = spawnOutput.stderr.toString().trim()
                if (error != ""){
                  Log.log(self.name + ': Error during screen on command: ')
                  Log.log(spawnOutput.stderr.toString())
                }
              }
            }
          }
          self.runScriptsInDirectory(callbackDir + '/on')
          self.sendSocketNotification("SCREENSAVE_DISABLED")
        } else {
          Log.log(self.name + ': Screen is forced to be off and will not be turned on!')
        }
      }
    } else {
      self.forcedDown = false
    }
  },

  toggleScreen: function (forced) {
    const self = this
    if (self.isScreenOn() === true) {
      self.turnScreenOff(forced)
      return false
    } else {
      self.turnScreenOn(forced)
      return true
    }
  },

  runScriptsInDirectory (directory) {
    const self = this
    Log.log(self.name + ': Running all scripts in: ' + directory)
    fs.readdir(directory, function (err, items) {
      if (err) {
        Log.log(err)
      } else {
        for (var i = 0; i < items.length; i++) {
          Log.log(self.name + ':   ' + items[i])
          let child = spawn(directory + '/' + items[i])

          let scriptErrorOutput = ""

          child.stderr.on('data', (data) => {
            scriptErrorOutput+=data.toString()
          });

          child.on('close', function(code) {
            scriptErrorOutput = scriptErrorOutput.trim()

            if (scriptErrorOutput != "") {
              Log.log(self.name + ': Error during script call: ')
              Log.log(scriptErrorOutput)
            }
          });
        }
      }
    })
  },

  clearAndSetScreenTimeout: function (reset, profileChange=false) {
    const self = this
    if ( self.deactivateMonitorTimeout ){
      clearTimeout(self.deactivateMonitorTimeout)
    }

    var currentDelay = self.config.delay

    for (var curConfigProfileString in self.config.profiles){
      if(self.currentProfilePattern.test(curConfigProfileString)){
        currentDelay = self.config.profiles[curConfigProfileString]
        if(profileChange && self.config.turnScreenOnIfProfileDelayIsSet){
          self.turnScreenOn(false)
        }
      }
    }

    if ((reset === true) && (currentDelay > 0)) {
      self.deactivateMonitorTimeout = setTimeout(function () {
        self.turnScreenOff(false)
        self.clearAndSetScreenTimeout(false)
      }, currentDelay * 1000)
      Log.log(this.name + ': Resetted screen timeout to ' + currentDelay + ' seconds!')
      self.sendSocketNotification("SCREEN_TIMEOUT_CHANGED", {delay: currentDelay})
    } else {
      Log.log(this.name + ': Disabled screen timeout!')
      self.sendSocketNotification("SCREEN_TIMEOUT_CHANGED", {delay: 0})
    }
  },

  socketNotificationReceived: function (notification, payload) {
    const self = this
    if (notification === 'CONFIG' && self.started === false) {
      self.config = payload
      self.clearAndSetScreenTimeout(true)
      self.started = true
    } else if (notification === 'SCREEN_MODULES_HIDDEN'){
      this.hiddenModules = payload
    } else if (notification === 'USER_PRESENCE') {
      if (payload && ((payload === true) || (payload==="true"))){
	      self.turnScreenOn(false)
        if (self.isScreenOn()){
          self.clearAndSetScreenTimeout(true)
        }
      }      
    } else if (notification === 'SCREEN_TOGGLE') {
      var forced = payload.forced === true ? payload.forced : false
      self.clearAndSetScreenTimeout(self.toggleScreen(forced))
    } else if (notification === 'SCREEN_ON') {
      var forced = payload.forced === true ? payload.forced : false
      self.turnScreenOn(forced)
      self.clearAndSetScreenTimeout(true);
    } else if (notification === 'SCREEN_OFF') {
      var forced = payload.forced === true ? payload.forced : false
      self.turnScreenOff(forced)
      self.clearAndSetScreenTimeout(false)
    } else if (notification === 'SCREEN_POWERSAVE') {
      if (payload.delay) {
        self.config.delay = payload.delay
      } else {
        self.config.delay = 0
      }
      self.clearAndSetScreenTimeout(true)
    } else if (notification === 'CHANGED_PROFILE'){
      if (!self.skipNextProfileChange){
        if(typeof payload.to !== 'undefined'){
          self.currentProfile = payload.to
          self.currentProfilePattern = new RegExp('\\b'+payload.to+'\\b')

          if (payload.to !== self.config.changeToProfile){
            if(self.config.profiles && (Object.keys(self.config.profiles).length > 0)){
              self.clearAndSetScreenTimeout(true, profileChange=true);
            }
          }
        }
      } else {
        self.skipNextProfileChange = false
      }
    } else {
      Log.log(this.name + ': Received Notification: ' + notification)
    }
  }
})
