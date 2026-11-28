// Orca Voice fork: a prototype that puts Orca on the watch's music controls.
// The watch's native player shows a "song" per agent session; next, previous,
// pause and the thumbs buttons become signals sent to Orca on the phone.
// See voice/garmin/README.md.

import Toybox.Application;
import Toybox.Lang;
import Toybox.Media;
import Toybox.WatchUi;

class OrcaRemoteApp extends Application.AudioContentProviderApp {

    function initialize() {
        AudioContentProviderApp.initialize();
    }

    function getContentDelegate(args) {
        return new OrcaContentDelegate();
    }

    function getSyncDelegate() {
        return new OrcaSyncDelegate();
    }

    function getPlaybackConfigurationView() {
        return OrcaMenu.build();
    }

    function getSyncConfigurationView() {
        return OrcaMenu.build();
    }

    function getProviderIconInfo() {
        return null;
    }
}
