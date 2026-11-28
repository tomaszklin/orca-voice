// Sends one event to Orca on the phone and records whether it got there.
// The web request checks, separately, whether the player may reach the
// network at all while it plays.

import Toybox.Communications;
import Toybox.Lang;

module OrcaSignal {
    const CHECK_URL = "https://api.github.com/zen";

    function send(event, session) {
        OrcaLog.add(event + " " + session);
        try {
            Communications.transmit({"orca" => 1, "event" => event, "session" => session}, null, new OrcaTransmitListener(event));
        } catch (e) {
            OrcaLog.add("tx wyjatek " + e.getErrorMessage());
        }
        try {
            Communications.makeWebRequest(CHECK_URL, null, {
                :method => Communications.HTTP_REQUEST_METHOD_GET,
                :responseType => Communications.HTTP_RESPONSE_CONTENT_TYPE_TEXT_PLAIN
            }, new OrcaWebCheck(event).method(:onResponse));
        } catch (e) {
            OrcaLog.add("web wyjatek " + e.getErrorMessage());
        }
    }
}

class OrcaTransmitListener extends Communications.ConnectionListener {
    var _event;

    function initialize(event) {
        ConnectionListener.initialize();
        _event = event;
    }

    function onComplete() {
        OrcaLog.add("tx ok " + _event);
    }

    function onError() {
        OrcaLog.add("tx blad " + _event);
    }
}

class OrcaWebCheck {
    var _event;

    function initialize(event) {
        _event = event;
    }

    function onResponse(code, data) {
        OrcaLog.add("web " + code + " " + _event);
    }
}
