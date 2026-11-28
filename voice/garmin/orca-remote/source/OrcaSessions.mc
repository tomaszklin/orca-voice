// The sessions the player steps through. Fixed names for the prototype; Orca
// on the phone will send the real list later.

import Toybox.Application.Storage;
import Toybox.Lang;

module OrcaSessions {
    const NAMES = ["orca-voice", "agents-skills", "zakupy"];
    const KEY_INDEX = "index";
    const KEY_REF = "ref";

    function count() {
        return NAMES.size();
    }

    function index() {
        var i = Storage.getValue(KEY_INDEX);
        return (i instanceof Number && i >= 0 && i < NAMES.size()) ? i : 0;
    }

    function setIndex(i) {
        Storage.setValue(KEY_INDEX, i);
    }

    function wrap(i) {
        return (i + NAMES.size()) % NAMES.size();
    }

    function name(i) {
        return NAMES[i];
    }

    function current() {
        return NAMES[index()];
    }

    // The one downloaded track every session plays (a short tick, then silence).
    function refId() {
        return Storage.getValue(KEY_REF);
    }

    function setRefId(id) {
        if (id == null) {
            Storage.deleteValue(KEY_REF);
        } else {
            Storage.setValue(KEY_REF, id);
        }
    }
}
