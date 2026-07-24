package com.tinker.glasschrome;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Android stub — Liquid Glass is an Apple platform material.
 * The WebView CSS chrome remains the Android surface.
 */
@CapacitorPlugin(name = "GlassChrome")
public class GlassChromePlugin extends Plugin {

    @PluginMethod
    public void isAvailable(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("available", false);
        ret.put("liquidGlass", false);
        call.resolve(ret);
    }

    @PluginMethod
    public void present(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("presented", false);
        call.resolve(ret);
    }

    @PluginMethod
    public void dismiss(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("dismissed", true);
        call.resolve(ret);
    }

    @PluginMethod
    public void setModeNav(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("ok", true);
        call.resolve(ret);
    }

    @PluginMethod
    public void setDrawerToggle(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("ok", true);
        call.resolve(ret);
    }
}
