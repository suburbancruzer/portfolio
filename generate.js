/**
 * Portfolio Generator
 * SSOT: model/content_en.json + model/content_de.json (edit these directly, EN/DE in parallel)
 * Usage:
 *   node generate.js          — read content JSONs → sync logos + write DOCX
 *   node generate.js --deploy — generate + git commit + push
 */

const https  = require("https");
const fs     = require("fs");
const path   = require("path");
const { execSync } = require("child_process");

const ROOT = __dirname;

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

// Logo paths in the content JSONs look like /img/logos/<domain>.<ext>.
// Any referenced logo missing on disk is fetched as PNG from the favicon API.
async function syncLogos(projects) {
    const logoDir = path.join(ROOT, "img", "logos");
    if (!fs.existsSync(logoDir)) fs.mkdirSync(logoDir, { recursive: true });
    let downloaded = 0;
    for (const p of projects) {
        const m = /^\/img\/logos\/(.+)\.(png|svg)$/.exec(p.logo || "");
        if (!m) continue;
        const domain = m[1];
        if (fs.existsSync(path.join(logoDir, domain + ".svg")) ||
            fs.existsSync(path.join(logoDir, domain + ".png"))) continue;
        const dest = path.join(logoDir, domain + ".png");
        try {
            await downloadLogo(domain, dest);
            console.log("  ✓ logo: " + domain);
            downloaded++;
        } catch (e) {
            console.warn("  ✗ logo failed: " + domain + " (" + e.message + ")");
        }
    }
    if (downloaded === 0) console.log("  ✓ logos up to date");
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

// ── GENERATE: content JSONs → logos + DOCX ────────────────────────────────────

async function generate() {
    const modelDir  = path.join(ROOT, "model");
    const contentEn = JSON.parse(fs.readFileSync(path.join(modelDir, "content_en.json"), "utf8"));
    const contentDe = JSON.parse(fs.readFileSync(path.join(modelDir, "content_de.json"), "utf8"));
    console.log("Reading model/content_en.json + model/content_de.json …");

    await syncLogos([...contentEn.projects_current, ...contentEn.projects_earlier]);

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
        execSync('git commit -m "chore: update portfolio content"', { cwd: ROOT, stdio: "inherit" });
        execSync("git push", { cwd: ROOT, stdio: "inherit" });
        console.log("✓ Deployed — GitHub Actions will update the live site.");
    } catch (e) {
        console.error("Git deploy failed:", e.message);
    }
}

// ── Entry point ───────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
if (args.includes("--deploy")) {
    deploy().catch(e => { console.error(e); process.exit(1); });
} else {
    generate().catch(e => { console.error(e); process.exit(1); });
}
