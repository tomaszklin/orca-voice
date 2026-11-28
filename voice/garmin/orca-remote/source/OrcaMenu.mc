// The provider's own screens: start playback, download the track, read the
// log of what happened, send a test signal.

import Toybox.Communications;
import Toybox.Graphics;
import Toybox.Lang;
import Toybox.Media;
import Toybox.WatchUi;

module OrcaMenu {
    function build() {
        var menu = new WatchUi.Menu2({:title => "Orca Remote"});
        menu.addItem(new WatchUi.MenuItem("Graj", OrcaSessions.current(), :play, null));
        menu.addItem(new WatchUi.MenuItem("Dziennik", null, :log, null));
        menu.addItem(new WatchUi.MenuItem("Test sygnalu", "bez odtwarzania", :test, null));
        menu.addItem(new WatchUi.MenuItem("Pobierz dzwiek", OrcaSessions.refId() == null ? "brak" : "jest", :sync, null));
        menu.addItem(new WatchUi.MenuItem("Wyczysc dziennik", null, :clear, null));
        return [menu, new OrcaMenuDelegate()];
    }
}

class OrcaMenuDelegate extends WatchUi.Menu2InputDelegate {
    function initialize() {
        Menu2InputDelegate.initialize();
    }

    function onSelect(item) {
        var id = item.getId();
        if (id == :play) {
            Media.startPlayback(null);
        } else if (id == :log) {
            var view = new OrcaLogView();
            WatchUi.pushView(view, new OrcaLogDelegate(view), WatchUi.SLIDE_LEFT);
        } else if (id == :test) {
            OrcaSignal.send("test", OrcaSessions.current());
            var view = new OrcaLogView();
            WatchUi.pushView(view, new OrcaLogDelegate(view), WatchUi.SLIDE_LEFT);
        } else if (id == :sync) {
            OrcaSessions.setRefId(null);
            Communications.startSync();
        } else if (id == :clear) {
            OrcaLog.clear();
        }
    }
}

class OrcaLogView extends WatchUi.View {
    var offset = 0;

    function initialize() {
        View.initialize();
    }

    function onUpdate(dc) {
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_BLACK);
        dc.clear();
        var lines = OrcaLog.all();
        var font = Graphics.FONT_XTINY;
        var h = dc.getFontHeight(font);
        var y = dc.getHeight() / 8;
        if (lines.size() == 0) {
            dc.drawText(dc.getWidth() / 2, dc.getHeight() / 2, font, "pusto", Graphics.TEXT_JUSTIFY_CENTER);
            return;
        }
        for (var i = offset; i < lines.size() && y < dc.getHeight() - h; i++) {
            dc.drawText(dc.getWidth() / 2, y, font, lines[i], Graphics.TEXT_JUSTIFY_CENTER);
            y += h;
        }
    }
}

class OrcaLogDelegate extends WatchUi.BehaviorDelegate {
    var _view;

    function initialize(view) {
        BehaviorDelegate.initialize();
        _view = view;
    }

    function onNextPage() {
        return scroll(4);
    }

    function onPreviousPage() {
        return scroll(-4);
    }

    function scroll(by) {
        var next = _view.offset + by;
        _view.offset = next < 0 ? 0 : next;
        WatchUi.requestUpdate();
        return true;
    }
}
