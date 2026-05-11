sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/ui/model/resource/ResourceModel",
    "sap/m/ObjectListItem",
    "sap/m/ObjectAttribute",
    "sap/m/Button",
    "sap/m/FlexBox",
    "sap/uxap/ObjectPageSubSection"
], function (Controller, JSONModel, ResourceModel, ObjectListItem, ObjectAttribute, Button, FlexBox, ObjectPageSubSection) {
    "use strict";

    var LIST_IDS = ["careerList", "projectList", "educationList", "certList"];
    var SKILL_COLORS = ["pmSkillTag--1", "pmSkillTag--2", "pmSkillTag--3", "pmSkillTag--4", "pmSkillTag--5"];

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
            this._renderSkillCategories(oData.skills || []);
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

        // ── Skill categories (dynamic) ───────────────────────────────────
        _renderSkillCategories: function (aSkills) {
            var oSection = this.getView().byId("sectionCompetencies");
            if (!oSection) { return; }
            oSection.destroySubSections();
            (aSkills || []).forEach(function (oCat, iIdx) {
                var sColorClass = SKILL_COLORS[iIdx % SKILL_COLORS.length];
                var oBox = new FlexBox({ wrap: "Wrap" }).addStyleClass("pmTagBox");
                (oCat.items || []).forEach(function (sSkill) {
                    oBox.addItem(
                        new Button({ text: sSkill, type: "Ghost" })
                            .addStyleClass("pmSkillTag " + sColorClass)
                    );
                });
                oSection.addSubSection(
                    new ObjectPageSubSection({ title: oCat.category, blocks: [oBox] })
                );
            });
        },

        // ── Contact ──────────────────────────────────────────────────────
        onContactPress: function () {
            window.location.href = "mailto:peter@mosboeck.net?subject=Project%20Inquiry";
        }
    });
});
