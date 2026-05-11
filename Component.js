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
            // super.init() processes manifest.json and sets manifest-declared models —
            // our overrides must come AFTER so they win over the manifest i18n model
            // (which would otherwise pick up the browser locale on German Windows).
            UIComponent.prototype.init.apply(this, arguments);

            // Synchronous XHR so the content model is ready before the async root view
            // renders and ObjectPageLayout calculates section heights.
            var oXhr = new XMLHttpRequest();
            oXhr.open("GET", "model/content_en.json", false);
            oXhr.send();
            this.setModel(new JSONModel(JSON.parse(oXhr.responseText)), "content");

            // Force EN regardless of browser locale.
            this.setModel(new ResourceModel({
                bundleUrl: "i18n/i18n.properties",
                supportedLocales: ["", "de"],
                fallbackLocale: "",
                bundleLocale: ""
            }), "i18n");
        }
    });
});
