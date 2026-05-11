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
        description_en: getRichText(pr.description_en),
        description_de: getRichText(pr.description_de)
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

async function syncLogos(projects) {
    const logoDir = path.join(ROOT, "img", "logos");
    if (!fs.existsSync(logoDir)) fs.mkdirSync(logoDir, { recursive: true });
    let downloaded = 0;
    for (const p of projects) {
        if (!p.logo_domain) continue;
        const dest = path.join(logoDir, p.logo_domain + ".png");
        if (fs.existsSync(dest)) continue;
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
        name:            getRichText(pr.name),
        title:           getRichText(pr.job_title),
        subtitle_en:     getRichText(pr.subtitle_en),
        subtitle_de:     getRichText(pr.subtitle_de),
        availability_en: getRichText(pr.availability_en),
        availability_de: getRichText(pr.availability_de),
        location_en:     getRichText(pr.location_en),
        location_de:     getRichText(pr.location_de),
        email:           getRichText(pr.email),
        profileText_en:  getRichText(pr.profileText_en),
        profileText_de:  getRichText(pr.profileText_de),
        skills_hcm:      getRichText(pr.skills_hcm),
        skills_fiori:    getRichText(pr.skills_fiori),
        skills_agile:    getRichText(pr.skills_agile),
        status:          pr.status?.select?.name || "available",
        available_from:  pr.available_from?.date?.start || null
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
            client:      p.client,
            logo:        p.logo_domain ? "/img/logos/" + p.logo_domain + ".png" : "",
            initials:    p.initials,
            period:      p["period_" + l],
            description: p["description_" + l]
        })),
        projects_earlier: projects.filter(p => !p.current).sort((a,b) => a.order-b.order).map(p => ({
            client:      p.client,
            logo:        p.logo_domain ? "/img/logos/" + p.logo_domain + ".png" : "",
            initials:    p.initials,
            period:      p["period_" + l],
            description: p["description_" + l]
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
    const { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
            Table, TableRow, TableCell, BorderStyle, WidthType } = require("docx");

    const SAP_BLUE  = "003366";
    const GRAY      = "595959";

    const h1 = (text) => new Paragraph({
        heading: HeadingLevel.HEADING_1,
        children: [new TextRun({ text, bold: true, color: SAP_BLUE, size: 32 })]
    });
    const h2 = (text) => new Paragraph({
        heading: HeadingLevel.HEADING_2,
        children: [new TextRun({ text, bold: true, color: SAP_BLUE, size: 24 })]
    });
    const body = (text, opts = {}) => new Paragraph({
        children: [new TextRun({ text, color: GRAY, size: 20, ...opts })]
    });
    const spacer = () => new Paragraph({ children: [new TextRun("")] });

    const sections_content = [
        // Header
        h1(content.name),
        body(content.title, { bold: true, size: 24 }),
        body(content.subtitle),
        body(content.availability),
        body(content.location),
        body(content.email),
        spacer(),

        // Profile
        h2(lang === "de" ? "Profil" : "Profile"),
        body(content.profileText),
        spacer(),

        // Skills
        h2(lang === "de" ? "Kompetenzen" : "Competencies"),
        ...content.skills.flatMap(cat => [body(cat.category + ": " + cat.items.join(", ")), spacer()]),

        // Career
        h2(lang === "de" ? "Karriere" : "Career"),
        ...content.career.flatMap(c => [
            body(c.year + " | " + c.role + " — " + c.company, { bold: true }),
            body(c.description),
            spacer()
        ]),

        // Projects
        h2(lang === "de" ? "Projekterfahrung" : "Project Experience"),
        ...[...content.projects_current, ...content.projects_earlier].flatMap(p => [
            body(p.period + " | " + p.client, { bold: true }),
            body(p.description),
            spacer()
        ]),

        // Education
        h2(lang === "de" ? "Ausbildung" : "Education"),
        ...content.education.flatMap(e => [
            body(e.year + " | " + e.degree, { bold: true }),
            body(e.institution + " — " + e.field),
            spacer()
        ]),

        // Certifications
        h2(lang === "de" ? "Zertifizierungen" : "Certifications"),
        ...content.certifications.map(c => body(c.year + " | " + c.title))
    ];

    const doc = new Document({
        sections: [{
            properties: {},
            children: sections_content
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
        profile: {
            name: "Profile",
            props: {
                name:            { rich_text: {} },
                job_title:       { rich_text: {} },
                subtitle_en:     { rich_text: {} },
                subtitle_de:     { rich_text: {} },
                availability_en: { rich_text: {} },
                availability_de: { rich_text: {} },
                location_en:     { rich_text: {} },
                location_de:     { rich_text: {} },
                email:           { rich_text: {} },
                profileText_en:  { rich_text: {} },
                profileText_de:  { rich_text: {} },
                skills_hcm:      { rich_text: {} },
                skills_fiori:    { rich_text: {} },
                skills_agile:    { rich_text: {} }
            }
        },
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

    const dbIds = {};
    for (const [key, def] of Object.entries(dbDefs)) {
        // Profile DB uses "role_title" as the title property; all others use "Name"
        const titlePropName = key === "profile" ? "role_title" : "Name";
        const db = await notionRequest("POST", "/v1/databases", {
            parent: { type: "page_id", page_id: rootId },
            title: richText(def.name),
            properties: {
                [titlePropName]: { title: {} },
                ...def.props
            }
        });
        dbIds[key] = db.id;
        console.log("  ✓ DB created: " + def.name + " (" + db.id + ")");
    }

    // Populate with current content
    const en = JSON.parse(fs.readFileSync(path.join(ROOT, "model/content_en.json"), "utf8"));
    const de = JSON.parse(fs.readFileSync(path.join(ROOT, "model/content_de.json"), "utf8"));

    // Profile row — role_title is the title-type property (Notion page display name)
    await notionRequest("POST", "/v1/pages", {
        parent: { database_id: dbIds.profile },
        properties: {
            role_title:      { title: richText(en.name) },
            name:            { rich_text: richText(en.name) },
            job_title:       { rich_text: richText(en.title) },
            subtitle_en:     { rich_text: richText(en.subtitle) },
            subtitle_de:     { rich_text: richText(de.subtitle) },
            availability_en: { rich_text: richText(en.availability) },
            availability_de: { rich_text: richText(de.availability) },
            location_en:     { rich_text: richText(en.location) },
            location_de:     { rich_text: richText(de.location) },
            email:           { rich_text: richText(en.email) },
            profileText_en:  { rich_text: richText(en.profileText) },
            profileText_de:  { rich_text: richText(de.profileText) },
            skills_hcm:      { rich_text: richText(en.skills.hcm.join(", ")) },
            skills_fiori:    { rich_text: richText(en.skills.fiori.join(", ")) },
            skills_agile:    { rich_text: richText(en.skills.agile.join(", ")) }
        }
    });

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
    fs.writeFileSync(CONFIG_PATH, JSON.stringify({ rootPageId: rootId, dbIds }, null, 2));
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
    const { dbIds } = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));

    console.log("Fetching from Notion…");

    const [profilePages, careerPages, projectPages, educationPages, certPages, skillPages] = await Promise.all([
        queryDatabase(dbIds.profile),
        queryDatabase(dbIds.career),
        queryDatabase(dbIds.projects),
        queryDatabase(dbIds.education),
        queryDatabase(dbIds.certifications),
        queryDatabase(dbIds.skills)
    ]);

    const profile   = pageToProfile(profilePages[0]);
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
