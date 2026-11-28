// What happened, newest first, kept in storage so the menu can show what the
// player process saw during a run.

import Toybox.Application.Storage;
import Toybox.Lang;
import Toybox.System;
import Toybox.Time;
import Toybox.Time.Gregorian;

module OrcaLog {
    const KEY = "log";
    const MAX = 40;

    function add(text) {
        var t = Gregorian.info(Time.now(), Time.FORMAT_SHORT);
        var line = t.hour.format("%02d") + ":" + t.min.format("%02d") + ":" + t.sec.format("%02d") + " " + text;
        System.println(line);
        var lines = [line];
        lines.addAll(all());
        if (lines.size() > MAX) {
            lines = lines.slice(0, MAX);
        }
        Storage.setValue(KEY, lines);
    }

    function all() {
        var lines = Storage.getValue(KEY);
        return (lines instanceof Array) ? lines : [];
    }

    function clear() {
        Storage.deleteValue(KEY);
    }
}
