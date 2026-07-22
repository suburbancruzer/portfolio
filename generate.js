/**
 * Portfolio Generator
 * Usage:
 *   node generate.js          — fetch Notion → write JSON + DOCX
 *   node generate.js --setup  — create Notion databases + populate from current JSON files
 *   node generate.js --deploy — generate + git commit + push
 */

const https  = require("https");
const fs     = require("fs");
const path   = require("path");
const { execSync } = require("child_process");

const ROOT        = __dirname;
const CONFIG_PATH = path.join(ROOT, "notion.config.json");
const TOKEN       = fs.readFileSync(
    path.join(process.env.HOME || process.env.USERPROFILE, ".config/notion/api_key"),
    "utf8"
).trim();
const NOTION_VERSION = "2022-06-28";

// ── Notion HTTP helper ─────────────────────────────────────────────────────────

function notionRequest(method, path, body) {
    return new Promise((resolve, reject) => {
        const payload = body ? Buffer.from(JSON.stringify(body), "utf8") : null;
        const req = https.request({
            hostname: "api.notion.com",
            path: path,
            method: method,
            headers: {
                "Authorization":  "Bearer " + TOKEN,
                "Notion-Version": NOTION_VERSION,
                "Content-Type":   "application/json",
                ...(payload ? { "Content-Length": payload.length } : {})
            }
        }, res => {
            let data = "";
            res.on("data", c => data += c);
            res.on("end", () => {
                try { resolve(JSON.parse(data)); }
                catch (e) { reject(new Error("JSON parse error: " + data)); }
            });
        });
        req.on("error", reject);
        if (payload) req.write(payload);
        req.end();
    });
}

async function fetchPage(pageId) {
    return notionRequest("GET", "/v1/pages/" + pageId);
}

async function queryDatabase(dbId) {
    const results = [];
    let cursor = undefined;
    do {
        const body = { page_size: 100 };
        if (cursor) body.start_cursor = cursor;
        const res = await notionRequest("POST", "/v1/databases/" + dbId + "/query", body);
        results.push(...(res.results || []));
        cursor = res.has_more ? res.next_cursor : undefined;
    } while (cursor);
    return results;
}

// ── Property helpers ───────────────────────────────────────────────────────────

function richText(str) {
    return [{ type: "text", text: { content: str || "" } }];
}
function getRichText(prop) {
    return (prop?.rich_text || prop?.title || []).map(t => t.plain_text).join("") || "";
}
function getNumber(prop) {
    return prop?.number ?? 0;
}

// ── Notion page → plain object converters ─────────────────────────────────────

function pageToCareer(p) {
    const pr = p.properties;
    const company_en = getRichText(pr.company);
    return {
        order:          getNumber(pr.order),
        year_en:        getRichText(pr.year_en),
        year_de:        getRichText(pr.year_de),
        role_en:        getRichText(pr.role_en),
        role_de:        getRichText(pr.role_de),
        company_en:     company_en,
        company_de:     getRichText(pr.company_de) || company_en,
        description_en: getRichText(pr.description_en),
        description_de: getRichText(pr.description_de)
    };
}
function projectInitials(name) {
    return name.replace(/\b(GmbH|AG|Ltd|Inc|Co)\b/g, "").trim()
        .split(/[\s\/\-–]+/).filter(Boolean).map(w => w[0].toUpperCase()).join("").substring(0, 2);
}
function pageToProject(p) {
    const pr = p.properties;
    const client      = getRichText(pr.client);
    const logo_domain = getRichText(pr.logo_domain);
    return {
        order:          getNumber(pr.order),
        current:        pr.current?.checkbox ?? false,
        client,
        logo_domain,
        initials:       projectInitials(client),
        period_en:      getRichText(pr.period_en),
        period_de:      getRichText(pr.period_de),
        project_title:  getRichText(pr.project_title),
        description_en: getRichText(pr.description_en),
        description_de: getRichText(pr.description_de),
        skills:         getRichText(pr.skills)
    };
}

// ── Logo sync: download missing logos from Google favicon API ─────────────────

function downloadLogo(domain, destPath) {
    return new Promise((resolve, reject) => {
        function get(url, hops) {
            if (hops <= 0) return reject(new Error("Too many redirects"));
            https.get(url, res => {
                if ((res.statusCode === 301 || res.statusCode === 302) && res.headers.location) {
                    res.resume();
                    return get(res.headers.location, hops - 1);
                }
                if (res.statusCode !== 200) { res.resume(); return reject(new Error("HTTP " + res.statusCode)); }
                const out = fs.createWriteStream(destPath);
                res.pipe(out);
                out.on("finish", resolve);
                out.on("error", reject);
            }).on("error", reject);
        }
        get("https://www.google.com/s2/favicons?domain=" + domain + "&sz=128", 5);
    });
}

function logoExt(domain) {
    const logoDir = path.join(ROOT, "img", "logos");
    if (fs.existsSync(path.join(logoDir, domain + ".svg"))) return ".svg";
    if (fs.existsSync(path.join(logoDir, domain + ".png"))) return ".png";
    return null;
}

async function syncLogos(projects) {
    const logoDir = path.join(ROOT, "img", "logos");
    if (!fs.existsSync(logoDir)) fs.mkdirSync(logoDir, { recursive: true });
    let downloaded = 0;
    for (const p of projects) {
        if (!p.logo_domain) continue;
        if (logoExt(p.logo_domain)) continue; // already have svg or png
        const dest = path.join(logoDir, p.logo_domain + ".png");
        try {
            await downloadLogo(p.logo_domain, dest);
            console.log("  ✓ logo: " + p.logo_domain);
            downloaded++;
        } catch (e) {
            console.warn("  ✗ logo failed: " + p.logo_domain + " (" + e.message + ")");
        }
    }
    if (downloaded === 0) console.log("  ✓ logos up to date");
}
function pageToEducation(p) {
    const pr = p.properties;
    return {
        order:          getNumber(pr.order),
        year:           getRichText(pr.year),
        degree_en:      getRichText(pr.degree_en),
        degree_de:      getRichText(pr.degree_de),
        institution_en: getRichText(pr.institution_en),
        institution_de: getRichText(pr.institution_de),
        field_en:       getRichText(pr.field_en),
        field_de:       getRichText(pr.field_de)
    };
}
function pageToSkill(p) {
    const pr = p.properties;
    return {
        name:           getRichText(pr.Name || pr.name),
        category_en:    getRichText(pr.category_en),
        category_de:    getRichText(pr.category_de),
        category_order: getNumber(pr.category_order),
        item_order:     getNumber(pr.item_order)
    };
}
function pageToCert(p) {
    const pr = p.properties;
    return {
        order: getNumber(pr.order),
        year:  getRichText(pr.year),
        title: getRichText(pr.title || pr.Name)
    };
}
const STATUS_MAP = {
    available: { en: "Available for projects", de: "Verfügbar für Projekte", state: "Success" },
    limited:   { en: "Limited availability",   de: "Geringe Verfügbarkeit",  state: "Warning" },
    booked:    { en: "Fully booked",           de: "Ausgelastet",            state: "Error"   }
};

const MONTHS_EN = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const MONTHS_DE = ["Januar","Februar","März","April","Mai","Juni","Juli","August","September","Oktober","November","Dezember"];

function availabilityText(status, availableFrom, lang) {
    const map = STATUS_MAP[status] || STATUS_MAP.available;
    if (status === "booked" && availableFrom) {
        const d = new Date(availableFrom);
        const months = lang === "de" ? MONTHS_DE : MONTHS_EN;
        const label = months[d.getUTCMonth()] + " " + d.getUTCFullYear();
        return lang === "de" ? "Verfügbar ab " + label : "Available from " + label;
    }
    return map[lang] || map.en;
}

function pageToProfile(p) {
    const pr = p.properties;
    return {
        name:           getRichText(pr.name),
        title:          getRichText(pr.job_title),
        subtitle_en:    getRichText(pr.subtitle_en),
        subtitle_de:    getRichText(pr.subtitle_de),
        location_en:    getRichText(pr.location_en),
        location_de:    getRichText(pr.location_de),
        email:          getRichText(pr.email),
        profileText_en: getRichText(pr.profileText_en),
        profileText_de: getRichText(pr.profileText_de),
        skills_hcm:     getRichText(pr.skills_hcm),
        skills_fiori:   getRichText(pr.skills_fiori),
        skills_agile:   getRichText(pr.skills_agile),
        status:         pr.status?.select?.name || "available",
        available_from: pr.available_from?.date?.start || null
    };
}

// ── Build content JSON from fetched rows ──────────────────────────────────────

function buildSkillCategories(lang, skills) {
    const catKey = "category_" + lang;
    const map = {};
    for (const s of skills.sort((a,b) => a.category_order - b.category_order || a.item_order - b.item_order)) {
        const cat = s[catKey] || s.category_en;
        if (!map[cat]) map[cat] = { category: cat, items: [] };
        map[cat].items.push(s.name);
    }
    return Object.values(map);
}

function buildContent(lang, profile, career, projects, education, certs, skills) {
    const l = lang; // "en" or "de"
    return {
        name:               profile.name,
        title:              profile.title,
        subtitle:           profile["subtitle_" + l],
        availability:       availabilityText(profile.status, profile.available_from, l),
        availabilityState:  (STATUS_MAP[profile.status] || STATUS_MAP.available).state,
        location:           profile["location_" + l],
        email:              profile.email,
        profileText:        profile["profileText_" + l],
        skills:             buildSkillCategories(l, skills),
        career: career.sort((a,b) => a.order-b.order).map(c => ({
            year:        c["year_" + l] || c.year_en,
            role:        c["role_" + l],
            company:     c["company_" + l] || c.company_en,
            description: c["description_" + l]
        })),
        projects_current: projects.filter(p => p.current).sort((a,b) => a.order-b.order).map(p => ({
            client:        p.client,
            logo:          p.logo_domain ? "/img/logos/" + p.logo_domain + (logoExt(p.logo_domain) || ".png") : "",
            initials:      p.initials,
            period:        p["period_" + l],
            project_title: p.project_title,
            description:   p["description_" + l],
            skills:        p.skills
        })),
        projects_earlier: projects.filter(p => !p.current).sort((a,b) => a.order-b.order).map(p => ({
            client:        p.client,
            logo:          p.logo_domain ? "/img/logos/" + p.logo_domain + (logoExt(p.logo_domain) || ".png") : "",
            initials:      p.initials,
            period:        p["period_" + l],
            project_title: p.project_title,
            description:   p["description_" + l],
            skills:        p.skills
        })),
        education: education.sort((a,b) => a.order-b.order).map(e => ({
            year:        e.year,
            degree:      e["degree_" + l],
            institution: e["institution_" + l],
            field:       e["field_" + l]
        })),
        certifications: certs.sort((a,b) => a.order-b.order).map(c => ({
            year:  c.year,
            title: c.title
        }))
    };
}

// ── DOCX generator ────────────────────────────────────────────────────────────

async function generateDocx(content, lang, outPath) {
    const { Document, Packer, Paragraph, TextRun, ImageRun,
            Table, TableRow, TableCell, BorderStyle, WidthType, ShadingType,
            HorizontalPositionRelativeFrom, VerticalPositionRelativeFrom, TextWrappingType,
            AlignmentType } = require("docx");

    const isDE   = lang === "de";
    const ACCENT = "31849B";   // template blue-teal (matches CV template exactly)
    const WHITE  = "FFFFFF";
    const DARK   = "1F2937";
    const FONT   = "Century Gothic";
    const TWS    = 9649; // total table width matching template (twips)
    const BORDER = { style: BorderStyle.SINGLE, size: 4, color: "D0D0D0" };
    const BORDERS = { top: BORDER, bottom: BORDER, left: BORDER, right: BORDER };

    // ── Photo (floating anchor, top-right of first paragraph) ─────────────────
    const photoPath = path.join(ROOT, "img", "profile.jpg");
    const photoRun = fs.existsSync(photoPath) ? new ImageRun({
        type: "jpg",
        data: fs.readFileSync(photoPath),
        transformation: { width: 175, height: 175 },
        floating: {
            horizontalPosition: { relative: HorizontalPositionRelativeFrom.COLUMN, offset: 4493931 },
            verticalPosition:   { relative: VerticalPositionRelativeFrom.PARAGRAPH, offset: -482600 },
            wrap: { type: TextWrappingType.NONE },
            allowOverlap: true,
            behindDocument: false
        }
    }) : null;

    // ── Helpers ───────────────────────────────────────────────────────────────
    const r = (text, opts = {}) =>
        new TextRun({ text: String(text || ""), font: FONT, size: 18, color: DARK, ...opts });

    const p0 = (text, opts = {}) => new Paragraph({
        children: Array.isArray(text) ? text : [r(text, opts)],
        spacing: { before: 0, after: 0 }
    });

    const gap = () => new Paragraph({
        children: [new TextRun("")],
        spacing: { before: 160, after: 0 }
    });

    const cell = (children, width, span = 1) => new TableCell({
        children: Array.isArray(children) ? children : [children],
        columnSpan: span,
        width: { size: width, type: WidthType.DXA },
        margins: { top: 60, bottom: 60, left: 120, right: 120 },
        borders: BORDERS
    });

    const headerCell = (text, span, width) => new TableCell({
        columnSpan: span,
        width: { size: width, type: WidthType.DXA },
        shading: { fill: ACCENT, type: ShadingType.SOLID },
        children: [new Paragraph({
            children: [r(text, { bold: true, color: WHITE, size: 22 })],
            spacing: { before: 0, after: 0 }
        })],
        margins: { top: 60, bottom: 60, left: 120, right: 120 },
        borders: BORDERS
    });

    const tbl = (rows) => new Table({ width: { size: TWS, type: WidthType.DXA }, rows });

    // Header row spanning all columns at full width
    const hRow = (text, span = 2) =>
        new TableRow({ children: [headerCell(text, span, TWS)] });

    // Projektreferenzen header row (3 blue cells: Kunden | Projekte | Kenntnisse)
    // matches Projektliste DOCX exactly: cell 1 not bold/dark, cells 2+3 bold/white
    const hRowProj = () => new TableRow({ children: [
        new TableCell({
            width: { size: 1996, type: WidthType.DXA },
            shading: { fill: ACCENT, type: ShadingType.SOLID },
            children: [new Paragraph({ children: [r("Kunden", { size: 22 })], spacing: { before: 0, after: 0 } })],
            margins: { top: 60, bottom: 60, left: 120, right: 120 },
            borders: BORDERS
        }),
        new TableCell({
            width: { size: 5651, type: WidthType.DXA },
            shading: { fill: ACCENT, type: ShadingType.SOLID },
            children: [new Paragraph({ children: [r(isDE ? "Projekte" : "Projects", { size: 22, bold: true, color: WHITE })], spacing: { before: 0, after: 0 } })],
            margins: { top: 60, bottom: 60, left: 120, right: 120 },
            borders: BORDERS
        }),
        new TableCell({
            width: { size: 2004, type: WidthType.DXA },
            shading: { fill: ACCENT, type: ShadingType.SOLID },
            children: [new Paragraph({ children: [r(isDE ? "Kenntnisse" : "Skills", { size: 22, bold: true, color: WHITE })], spacing: { before: 0, after: 0 } })],
            margins: { top: 60, bottom: 60, left: 120, right: 120 },
            borders: BORDERS
        }),
    ]});

    // Projektreferenzen data row (Kunden | Projekte | Kenntnisse)
    const rowProj = (c1, c2, c3) => new TableRow({ children: [
        cell(Array.isArray(c1) ? c1 : [c1], 1996),
        cell(Array.isArray(c2) ? c2 : [c2], 5651),
        cell(Array.isArray(c3) ? c3 : [c3], 2004)
    ]});

    // Hardskills combined header row (3 blue cells: label | NIVEAU | SEIT)
    const hRowHS = () => new TableRow({ children: [
        new TableCell({
            width: { size: 5680, type: WidthType.DXA },
            shading: { fill: ACCENT, type: ShadingType.SOLID },
            children: [new Paragraph({ children: [r("Hardskills", { size: 22 })], spacing: { before: 0, after: 0 } })],
            margins: { top: 60, bottom: 60, left: 120, right: 120 },
            borders: BORDERS
        }),
        new TableCell({
            width: { size: 2268, type: WidthType.DXA },
            shading: { fill: ACCENT, type: ShadingType.SOLID },
            children: [new Paragraph({ children: [r("NIVEAU", { size: 22, bold: true, color: WHITE })], spacing: { before: 0, after: 0 } })],
            margins: { top: 60, bottom: 60, left: 120, right: 120 },
            borders: BORDERS
        }),
        new TableCell({
            width: { size: 1703, type: WidthType.DXA },
            shading: { fill: ACCENT, type: ShadingType.SOLID },
            children: [new Paragraph({ children: [r("SEIT", { size: 22, bold: true, color: WHITE })], spacing: { before: 0, after: 0 } })],
            margins: { top: 60, bottom: 60, left: 120, right: 120 },
            borders: BORDERS
        }),
    ]});

    // PERSÖNLICHES PROFIL: 2-col 2704+6945
    const rowP = (label, valueChildren) => new TableRow({ children: [
        cell(p0([r(label, { bold: true })]), 2704),
        cell(Array.isArray(valueChildren) ? valueChildren : [valueChildren], 6945)
    ]});

    // BERUFLICHER WERDEGANG: 3-col 2139+3402+3827  (no description)
    const rowC = (c1, c2, c3) => new TableRow({ children: [
        cell(Array.isArray(c1) ? c1 : [c1], 2139),
        cell(Array.isArray(c2) ? c2 : [c2], 3402),
        cell(Array.isArray(c3) ? c3 : [c3], 3827)
    ]});

    // AUSBILDUNG + TRAININGSAKTIVITÄTEN: 2-col 1713+7938
    const rowE = (label, valueChildren) => new TableRow({ children: [
        cell(p0([r(label, { bold: true })]), 1713),
        cell(Array.isArray(valueChildren) ? valueChildren : [valueChildren], 7938)
    ]});

    // SPRACHEN: 2-col 4123+5528
    const rowL = (label, valueChildren) => new TableRow({ children: [
        cell(p0([r(label, { bold: true })]), 4123),
        cell(Array.isArray(valueChildren) ? valueChildren : [valueChildren], 5528)
    ]});

    // Hardskills: 3-col 5680+2268+1703
    const rowH = (c1, c2, c3) => new TableRow({ children: [
        cell(Array.isArray(c1) ? c1 : [c1], 5680),
        cell(Array.isArray(c2) ? c2 : [c2], 2268),
        cell(Array.isArray(c3) ? c3 : [c3], 1703)
    ]});

    // Softskills / Hobbies: 1-col full width
    const row1 = (text) => new TableRow({ children: [cell(p0(text), TWS)] });

    // ── Hardcoded static data (matches template) ──────────────────────────────
    const HARDSKILLS = isDE ? [
        ["SAP HCM", "PA, OM, ESS, MSS, Processes & Forms, CATS", "Spezialist", "2010"],
        ["ABAP Programming", "RAP, CDS, ABAP Objects, Business Workflow, Adobe Forms, ABAP Web Dynpro", "Spezialist", "2008"],
        ["Fiori", "SAPUI5, Odata, Web IDE, VS Code, BAS, git", "Spezialist", "2016"],
        ["Agile", "Scrum, Kanban, Scrumban, Design Thinking / UX", "Experte", "2016"],
        ["SAP HCM", "PY, PT, Travel", "Experte", "2010"],
        ["Weitere SAP Module", "MM, SD, FI und CO", "Fortgeschritten", "2005"],
    ] : [
        ["SAP HCM", "PA, OM, ESS, MSS, Processes & Forms, CATS", "Specialist", "2010"],
        ["ABAP Programming", "RAP, CDS, ABAP Objects, Business Workflow, Adobe Forms, ABAP Web Dynpro", "Specialist", "2008"],
        ["Fiori", "SAPUI5, Odata, Web IDE, VS Code, BAS, git", "Specialist", "2016"],
        ["Agile", "Scrum, Kanban, Scrumban, Design Thinking / UX", "Expert", "2016"],
        ["SAP HCM", "PY, PT, Travel", "Expert", "2010"],
        ["Further SAP modules", "MM, SD, FI, CO", "Advanced", "2005"],
    ];

    const SOFTSKILLS = isDE ? [
        "Kunden- und Serviceorientierung",
        "Hohes Qualitätsbewusstsein",
        "Kommunikationsfähigkeit & Empathie",
        "Kompromissbereitschaft & Flexibilität",
        "Problemlösungskompetenz",
        "Überzeugungsvermögen und Überzeugungskraft",
        "Weitsicht & Kreativität",
        "Teamfähigkeit",
    ] : [
        "Customer and service orientation",
        "High quality awareness",
        "Communication skills & empathy",
        "Willingness to compromise & flexibility",
        "Problem-solving competence",
        "Persuasiveness and conviction",
        "Foresight & creativity",
        "Teamwork",
    ];

    const HOBBIES = isDE
        ? ["Geocaching & Wandern", "Hundesport", "Gesellschaftsspiele (wie Exit Rooms)"]
        : ["Geocaching & hiking", "Dog sports", "Board games (such as escape rooms)"];

    // ── Document ──────────────────────────────────────────────────────────────
    const doc = new Document({
        sections: [{
            properties: {
                // Template margins: top=1610, bottom=1276, left=1134, right=1134
                page: { margin: { top: 1610, bottom: 1276, left: 1134, right: 1134 } }
            },
            children: [
                // ── CV title (matches template [ste] paragraphs) ──────────────
                // Photo is anchored to this paragraph (floats top-right)
                new Paragraph({
                    children: photoRun
                        ? [photoRun, r(isDE ? "Lebenslauf" : "Curriculum Vitae", { size: 44, bold: true })]
                        : [r(isDE ? "Lebenslauf" : "Curriculum Vitae", { size: 44, bold: true })],
                    spacing: { before: 0, after: 80 }
                }),
                new Paragraph({
                    children: [r(content.name, { size: 30, bold: true })],
                    spacing: { before: 0, after: 1400 }   // extra space so floating photo doesn't overlap first table
                }),

                // ── 1. PERSÖNLICHES PROFIL ────────────────────────────────────
                tbl([
                    hRow(isDE ? "PERSÖNLICHES PROFIL" : "PERSONAL PROFILE"),
                    rowP(isDE ? "Akademischer Grad" : "Academic Degree", p0("Master of Science Engineering (MSc.)")),
                    rowP(isDE ? "Jahrgang"     : "Year of Birth",  p0("1987")),
                    rowP(isDE ? "Nationalität" : "Nationality",    p0(isDE ? "Österreich" : "Austria")),
                    rowP(isDE ? "Position"     : "Position",       p0(content.title)),
                    rowP(isDE ? "Adresse"      : "Address",
                        p0(isDE ? "Rembrandtstraße 8, 2231 Strasshof an der Nordbahn" : "Vienna Area, Austria")),
                    rowP("Handy", p0("0043/664/6332001")),
                    rowP("E-Mail", p0(content.email)),
                ]),
                gap(),

                // ── 2. BERUFLICHER WERDEGANG (year | company | role) ──────────
                tbl([
                    hRow(isDE ? "BERUFLICHER WERDEGANG" : "CAREER", 3),
                    ...content.career.map(c => rowC(
                        [p0(c.year)],
                        [p0([r(c.company, { bold: true })])],
                        [p0(c.role)]
                    ))
                ]),
                gap(),

                // ── 3. PROJEKTREFERENZEN (matches Projektliste structure) ─────
                tbl([
                    hRowProj(),
                    ...[...content.projects_current, ...content.projects_earlier].map(proj => {
                        // Column 1: Kunden = client name (bold) + period
                        const col1 = [p0([r(proj.client, { bold: true })])];
                        if (proj.period) col1.push(p0(proj.period));

                        // Column 2: Projekte = project_title + description paragraphs
                        const col2 = [];
                        if (proj.project_title) col2.push(p0(proj.project_title));
                        if (proj.description) {
                            // Split description on newlines into separate paragraphs (like Projektliste)
                            proj.description.split(/\n+/).filter(Boolean).forEach(line => col2.push(p0(line)));
                        }
                        if (col2.length === 0) col2.push(p0(""));

                        // Column 3: Kenntnisse = skills (all bold, like Projektliste)
                        const col3 = [p0([r(proj.skills || "", { bold: true })])];

                        return rowProj(col1, col2, col3);
                    })
                ]),
                gap(),

                // ── 4. AUSBILDUNG ─────────────────────────────────────────────
                tbl([
                    hRow(isDE ? "AUSBILDUNG" : "EDUCATION"),
                    ...content.education.map(e => rowE(e.year, [
                        p0([r(e.institution, { bold: true })]),
                        p0(e.degree + (e.field ? ", " + e.field : ""))
                    ]))
                ]),
                gap(),

                // ── 4. SPRACHEN ───────────────────────────────────────────────
                tbl([
                    hRow(isDE ? "SPRACHEN" : "LANGUAGES"),
                    rowL("Deutsch",  p0(isDE ? "Muttersprache"      : "Native")),
                    rowL("Englisch", p0(isDE ? "Verhandlungssicher"  : "Business fluent"))
                ]),
                gap(),

                // ── 5. Hardskills (skill+detail | NIVEAU | SEIT) ─────────────
                tbl([
                    hRowHS(),
                    ...HARDSKILLS.map(([header, detail, niveau, seit]) => rowH(
                        [p0([r(header, { bold: true })]), p0(detail)],
                        [p0(niveau)],
                        [p0(seit)]
                    ))
                ]),
                gap(),

                // ── 6. Softskills ─────────────────────────────────────────────
                tbl([
                    hRow("Softskills", 1),
                    ...SOFTSKILLS.map(s => row1(s))
                ]),
                gap(),

                // ── 7. Hobbies ────────────────────────────────────────────────
                tbl([
                    hRow("Hobbies", 1),
                    ...HOBBIES.map(h => row1(h))
                ]),
                gap(),

                // ── 8. TRAININGSAKTIVITÄTEN ───────────────────────────────────
                tbl([
                    hRow(isDE ? "TRAININGSAKTIVITÄTEN" : "TRAINING ACTIVITIES"),
                    ...content.certifications.map(c => rowE(c.year, p0(c.title)))
                ]),
            ]
        }]
    });

    const buffer = await Packer.toBuffer(doc);
    fs.writeFileSync(outPath, buffer);
    console.log("  ✓ " + path.basename(outPath));
}

// ── SETUP: Create Notion databases + populate ─────────────────────────────────

async function setup() {
    console.log("Setting up Notion databases…");

    // Create Portfolio page as child of the "SAP" workspace page
    // (341c5a79... = "SAP" page, workspace root, accessible via integration)
    const SAP_PAGE_ID = "341c5a79-731c-801d-9475-e3c573ada997";
    const rootPage = await notionRequest("POST", "/v1/pages", {
        parent: { type: "page_id", page_id: SAP_PAGE_ID },
        properties: {
            title: { title: richText("Portfolio — Peter Mosböck") }
        }
    });
    if (rootPage.object === "error") {
        console.error("Cannot create Portfolio page:", rootPage.message);
        process.exit(1);
    }
    const rootId = rootPage.id;
    console.log("  ✓ Root page created:", rootId);

    // Database schemas
    const dbDefs = {
        career: {
            name: "Career",
            props: {
                order:          { number: {} },
                year_en:        { rich_text: {} },
                year_de:        { rich_text: {} },
                role_en:        { rich_text: {} },
                role_de:        { rich_text: {} },
                company:        { rich_text: {} },
                description_en: { rich_text: {} },
                description_de: { rich_text: {} }
            }
        },
        projects: {
            name: "Projects",
            props: {
                order:          { number: {} },
                client:         { rich_text: {} },
                period_en:      { rich_text: {} },
                period_de:      { rich_text: {} },
                description_en: { rich_text: {} },
                description_de: { rich_text: {} }
            }
        },
        education: {
            name: "Education",
            props: {
                order:          { number: {} },
                year:           { rich_text: {} },
                degree_en:      { rich_text: {} },
                degree_de:      { rich_text: {} },
                institution_en: { rich_text: {} },
                institution_de: { rich_text: {} },
                field_en:       { rich_text: {} },
                field_de:       { rich_text: {} }
            }
        },
        certifications: {
            name: "Certifications",
            props: {
                order: { number: {} },
                year:  { rich_text: {} }
            }
        }
    };

    // Profile: single page with a minimal inline DB (properties require a DB parent in Notion)
    const profileDb = await notionRequest("POST", "/v1/databases", {
        parent: { type: "page_id", page_id: rootId },
        title: richText("Profile"),
        is_inline: true,
        properties: {
            role_title:     { title: {} },
            name:           { rich_text: {} },
            job_title:      { rich_text: {} },
            subtitle_en:    { rich_text: {} },
            subtitle_de:    { rich_text: {} },
            location_en:    { rich_text: {} },
            location_de:    { rich_text: {} },
            email:          { rich_text: {} },
            profileText_en: { rich_text: {} },
            profileText_de: { rich_text: {} },
            skills_hcm:     { rich_text: {} },
            skills_fiori:   { rich_text: {} },
            skills_agile:   { rich_text: {} },
            status:         { select: { options: [
                { name: "available", color: "green" },
                { name: "limited",   color: "yellow" },
                { name: "booked",    color: "red" }
            ]}},
            available_from: { date: {} }
        }
    });
    console.log("  ✓ Profile DB created (inline): " + profileDb.id);

    // Populate with current content
    const en = JSON.parse(fs.readFileSync(path.join(ROOT, "model/content_en.json"), "utf8"));
    const de = JSON.parse(fs.readFileSync(path.join(ROOT, "model/content_de.json"), "utf8"));

    const profilePage = await notionRequest("POST", "/v1/pages", {
        parent: { database_id: profileDb.id },
        properties: {
            role_title:     { title: richText(en.name) },
            name:           { rich_text: richText(en.name) },
            job_title:      { rich_text: richText(en.title) },
            subtitle_en:    { rich_text: richText(en.subtitle) },
            subtitle_de:    { rich_text: richText(de.subtitle) },
            location_en:    { rich_text: richText(en.location) },
            location_de:    { rich_text: richText(de.location) },
            email:          { rich_text: richText(en.email) },
            profileText_en: { rich_text: richText(en.profileText) },
            profileText_de: { rich_text: richText(de.profileText) },
            skills_hcm:     { rich_text: richText(en.skills.hcm.join(", ")) },
            skills_fiori:   { rich_text: richText(en.skills.fiori.join(", ")) },
            skills_agile:   { rich_text: richText(en.skills.agile.join(", ")) },
            status:         { select: { name: "available" } }
        }
    });
    const profilePageId = profilePage.id;
    console.log("  ✓ Profile page created: " + profilePageId);

    const dbIds = {};
    for (const [key, def] of Object.entries(dbDefs)) {
        const db = await notionRequest("POST", "/v1/databases", {
            parent: { type: "page_id", page_id: rootId },
            title: richText(def.name),
            properties: { Name: { title: {} }, ...def.props }
        });
        dbIds[key] = db.id;
        console.log("  ✓ DB created: " + def.name + " (" + db.id + ")");
    }

    // Career rows
    for (let i = 0; i < en.career.length; i++) {
        const c = en.career[i], cd = de.career[i];
        await notionRequest("POST", "/v1/pages", {
            parent: { database_id: dbIds.career },
            properties: {
                Name:           { title: richText(c.year + " | " + c.role) },
                order:          { number: i + 1 },
                year_en:        { rich_text: richText(c.year) },
                year_de:        { rich_text: richText(cd.year) },
                role_en:        { rich_text: richText(c.role) },
                role_de:        { rich_text: richText(cd.role) },
                company:        { rich_text: richText(c.company) },
                description_en: { rich_text: richText(c.description) },
                description_de: { rich_text: richText(cd.description) }
            }
        });
    }

    // Project rows
    for (let i = 0; i < en.projects.length; i++) {
        const p = en.projects[i], pd = de.projects[i];
        await notionRequest("POST", "/v1/pages", {
            parent: { database_id: dbIds.projects },
            properties: {
                Name:           { title: richText(p.client) },
                order:          { number: i + 1 },
                client:         { rich_text: richText(p.client) },
                period_en:      { rich_text: richText(p.period) },
                period_de:      { rich_text: richText(pd.period) },
                description_en: { rich_text: richText(p.description) },
                description_de: { rich_text: richText(pd.description) }
            }
        });
    }

    // Education rows
    for (let i = 0; i < en.education.length; i++) {
        const e = en.education[i], ed = de.education[i];
        await notionRequest("POST", "/v1/pages", {
            parent: { database_id: dbIds.education },
            properties: {
                Name:           { title: richText(e.year + " | " + e.degree) },
                order:          { number: i + 1 },
                year:           { rich_text: richText(e.year) },
                degree_en:      { rich_text: richText(e.degree) },
                degree_de:      { rich_text: richText(ed.degree) },
                institution_en: { rich_text: richText(e.institution) },
                institution_de: { rich_text: richText(ed.institution) },
                field_en:       { rich_text: richText(e.field) },
                field_de:       { rich_text: richText(ed.field) }
            }
        });
    }

    // Certification rows
    for (let i = 0; i < en.certifications.length; i++) {
        const c = en.certifications[i];
        await notionRequest("POST", "/v1/pages", {
            parent: { database_id: dbIds.certifications },
            properties: {
                Name:  { title: richText(c.title) },
                order: { number: i + 1 },
                year:  { rich_text: richText(c.year) }
            }
        });
    }

    // Save config
    fs.writeFileSync(CONFIG_PATH, JSON.stringify({ rootPageId: rootId, profilePageId, dbIds }, null, 2));
    console.log("\n✓ Setup complete! Config saved to notion.config.json");
    console.log("  Notion page: https://notion.so/" + rootId.replace(/-/g, ""));
    console.log("\nNow run: node generate.js");
}

// ── GENERATE: Fetch Notion → JSON + DOCX ─────────────────────────────────────

async function generate() {
    if (!fs.existsSync(CONFIG_PATH)) {
        console.error("notion.config.json not found. Run: node generate.js --setup");
        process.exit(1);
    }
    const { profilePageId, dbIds } = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));

    console.log("Fetching from Notion…");

    const [profilePage, careerPages, projectPages, educationPages, certPages, skillPages] = await Promise.all([
        fetchPage(profilePageId),
        queryDatabase(dbIds.career),
        queryDatabase(dbIds.projects),
        queryDatabase(dbIds.education),
        queryDatabase(dbIds.certifications),
        queryDatabase(dbIds.skills)
    ]);

    const profile   = pageToProfile(profilePage);
    const career    = careerPages.map(pageToCareer);
    const projects  = projectPages.map(pageToProject);
    const education = educationPages.map(pageToEducation);
    const certs     = certPages.map(pageToCert);
    const skills    = skillPages.map(pageToSkill);

    await syncLogos(projects);

    const contentEn = buildContent("en", profile, career, projects, education, certs, skills);
    const contentDe = buildContent("de", profile, career, projects, education, certs, skills);

    // Write JSON
    const modelDir = path.join(ROOT, "model");
    fs.writeFileSync(path.join(modelDir, "content_en.json"), JSON.stringify(contentEn, null, 2));
    fs.writeFileSync(path.join(modelDir, "content_de.json"), JSON.stringify(contentDe, null, 2));
    console.log("  ✓ model/content_en.json");
    console.log("  ✓ model/content_de.json");

    // Write DOCX to OneDrive CVs folder
    const outDir = path.join(
        process.env.USERPROFILE,
        "OneDrive - Peter Mosböck", "Business", "Sales", "CVs"
    );
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    await generateDocx(contentEn, "en", path.join(outDir, "cv_peter_mosboeck_en.docx"));
    await generateDocx(contentDe, "de", path.join(outDir, "cv_peter_mosboeck_de.docx"));

    console.log("\n✓ Generation complete!");
    return { contentEn, contentDe };
}

// ── DEPLOY: generate + git commit + push ─────────────────────────────────────

async function deploy() {
    await generate();
    console.log("\nDeploying…");
    try {
        execSync("git add model/content_en.json model/content_de.json img/logos/", { cwd: ROOT, stdio: "inherit" });
        execSync('git commit -m "chore: regenerate content from Notion"', { cwd: ROOT, stdio: "inherit" });
        execSync("git push", { cwd: ROOT, stdio: "inherit" });
        console.log("✓ Deployed — GitHub Actions will update the live site.");
    } catch (e) {
        console.error("Git deploy failed:", e.message);
    }
}

// ── Entry point ───────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
if (args.includes("--setup")) {
    setup().catch(e => { console.error(e); process.exit(1); });
} else if (args.includes("--deploy")) {
    deploy().catch(e => { console.error(e); process.exit(1); });
} else {
    generate().catch(e => { console.error(e); process.exit(1); });
}
