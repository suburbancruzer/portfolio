sap.ui.define([
    "sap/ui/core/UIComponent",
    "sap/ui/model/json/JSONModel",
    "sap/ui/model/resource/ResourceModel"
], function (UIComponent, JSONModel, ResourceModel) {
    "use strict";

    return UIComponent.extend("mosboeck.portfolio.Component", {

        metadata: {
            manifest: "json"
        },

        init: function () {
            // Load content synchronously so ObjectPageLayout sees correct section heights
            // on the very first render (avoids async timing issues with section offsets).
            var oXhr = new XMLHttpRequest();
            oXhr.open("GET", "model/content_en.json", false);
            oXhr.send();
            this.setModel(new JSONModel(JSON.parse(oXhr.responseText)), "content");

            // Force i18n to English regardless of browser locale so i18n labels and
            // content model are always in the same language on initial load.
            // bundleLocale "" = English (matches fallbackLocale in manifest).
            this.setModel(new ResourceModel({
                bundleUrl: "i18n/i18n.properties",
                supportedLocales: ["", "de"],
                fallbackLocale: "",
                bundleLocale: ""
            }), "i18n");

            UIComponent.prototype.init.apply(this, arguments);
        }
    });
});
