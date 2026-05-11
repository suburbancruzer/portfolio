sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/ui/model/resource/ResourceModel",
    "sap/m/ObjectListItem",
    "sap/m/ObjectAttribute",
    "sap/m/Button"
], function (Controller, JSONModel, ResourceModel, ObjectListItem, ObjectAttribute, Button) {
    "use strict";

    var SKILL_CATEGORIES = ["hcm", "fiori", "agile"];
    var LIST_IDS = ["careerList", "projectList", "educationList", "certList"];

    return Controller.extend("mosboeck.portfolio.controller.Main", {

        _currentLang: "en",

        onInit: function () {
            // Component.js loads the "content" model synchronously before creating the root
            // view, so it propagates here via Component → View model inheritance.
            var oModel = this.getOwnerComponent().getModel("content");
            if (oModel) {
                this._populateDynamic(oModel.getData());
            }
        },

        // ── Language toggle ──────────────────────────────────────────────
        onToggleLanguage: function () {
            this._currentLang = this._currentLang === "en" ? "de" : "en";
            var sLang = this._currentLang;
            var oComponent = this.getOwnerComponent();

            var oContent = new JSONModel("model/content_" + sLang + ".json");
            oContent.attachRequestCompleted(function () {
                // Set on component so the updated model propagates across all views
                oComponent.setModel(oContent, "content");
                this._populateDynamic(oContent.getData());
            }, this);

            var oI18n = new ResourceModel({
                bundleUrl: "i18n/i18n.properties",
                supportedLocales: ["", "de"],
                fallbackLocale: "",
                bundleLocale: sLang === "de" ? "de" : ""
            });
            oComponent.setModel(oI18n, "i18n");
        },

        // ── Populate lists + skill tags ──────────────────────────────────
        _populateDynamic: function (oData) {
            if (!oData) { return; }

            this._bindList("careerList", "content>/career",
                new ObjectListItem({
                    title: "{content>role}",
                    intro: "{content>year}",
                    number: "{content>company}",
                    type: "Inactive",
                    attributes: [ new ObjectAttribute({ text: "{content>description}" }) ]
                })
            );
            this._bindList("projectList", "content>/projects",
                new ObjectListItem({
                    title: "{content>client}",
                    intro: "{content>period}",
                    type: "Inactive",
                    attributes: [ new ObjectAttribute({ text: "{content>description}" }) ]
                })
            );
            this._bindList("educationList", "content>/education",
                new ObjectListItem({
                    title: "{content>degree}",
                    intro: "{content>year}",
                    number: "{content>field}",
                    type: "Inactive",
                    attributes: [ new ObjectAttribute({ text: "{content>institution}" }) ]
                })
            );
            this._bindList("certList", "content>/certifications",
                new ObjectListItem({
                    title: "{content>title}",
                    intro: "{content>year}",
                    type: "Inactive"
                })
            );
            this._renderSkillTags(oData.skills || {});
            this._notifyObjectPageOnAllListsReady();
        },

        _bindList: function (sId, sPath, oTemplate) {
            var oList = this.getView().byId(sId);
            if (oList) {
                oList.bindItems({ path: sPath, template: oTemplate });
            }
        },

        // ── Trigger ObjectPage layout recalc once all lists have rendered ─
        _notifyObjectPageOnAllListsReady: function () {
            var oView = this.getView();
            var iDone = 0;

            var fnCheck = function () {
                iDone++;
                if (iDone >= LIST_IDS.length) {
                    requestAnimationFrame(function () {
                        window.dispatchEvent(new Event("resize"));
                    });
                }
            };

            LIST_IDS.forEach(function (sId) {
                var oList = oView.byId(sId);
                if (oList) {
                    oList.attachEventOnce("updateFinished", fnCheck);
                } else {
                    fnCheck();
                }
            });
        },

        // ── Skill chips ──────────────────────────────────────────────────
        _renderSkillTags: function (oSkills) {
            SKILL_CATEGORIES.forEach(function (sCategory) {
                var oBox = this.getView().byId(sCategory + "TagBox");
                if (!oBox) { return; }
                oBox.destroyItems();
                (oSkills[sCategory] || []).forEach(function (sSkill) {
                    oBox.addItem(
                        new Button({ text: sSkill, type: "Ghost" })
                            .addStyleClass("pmSkillTag pmSkillTag--" + sCategory)
                    );
                });
            }, this);
        },

        // ── Contact ──────────────────────────────────────────────────────
        onContactPress: function () {
            window.location.href = "mailto:peter@mosboeck.net?subject=Project%20Inquiry";
        }
    });
});
