Plugin = require('../plugin')

AnnotationSync = require('../annotation-sync')
Bridge = require('../../shared/bridge')
Discovery = require('../../shared/discovery')
frameUtil = require('../util/frame-util')


# Extracts individual keys from an object and returns a new one.
extract = extract = (obj, keys...) ->
  ret = {}
  ret[key] = obj[key] for key in keys when obj.hasOwnProperty(key)
  ret

# Class for establishing a messaging connection to the parent sidebar as well
# as keeping the annotation state in sync with the sidebar application, this
# frame acts as the bridge client, the sidebar is the server. This plugin
# can also be used to send messages through to the sidebar using the
# call method.
module.exports = class CrossFrame extends Plugin
  constructor: (elem, options) ->
    super

    opts = extract(options, 'server')
    discovery = new Discovery(window, opts)

    bridge = new Bridge()

    opts = extract(options, 'on', 'emit')
    annotationSync = new AnnotationSync(bridge, opts)

    this.pluginInit = ->
      onDiscoveryCallback = (source, origin, token) ->
        bridge.createChannel(source, origin, token)
      discovery.startDiscovery(onDiscoveryCallback)

      # THESIS TODO: Disabled until fully implemented.
      # 
      # Find, and inject Hypothesis into Guest's iframes
      # _discoverOwnFrames()

    this.destroy = ->
      # super doesnt work here :(
      Plugin::destroy.apply(this, arguments)
      bridge.destroy()
      discovery.stopDiscovery()

    this.sync = (annotations, cb) ->
      annotationSync.sync(annotations, cb)

    this.on = (event, fn) ->
      bridge.on(event, fn)

    this.call = (message, args...) ->
      bridge.call(message, args...)

    this.onConnect = (fn) ->
      bridge.onConnect(fn)

    _discoverOwnFrames = () ->
      # Discover existing iframes
      iframes = frameUtil.findIFrames(elem)
      _handleIFrames(iframes)

    _handleIFrame = (iframe) ->
      if !frameUtil.isAccessible(iframe) then return

      if !frameUtil.hasHypothesis(iframe)
        frameUtil.injectHypothesis(iframe)

    _handleIFrames = (iframes) ->
      for own index, iframe of iframes
        _handleIFrame(iframe)


