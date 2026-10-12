const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = __dirname;
const pageNames = ["index.html", "terms.html", "privacy.html", "support.html"];
const pages = new Map(pageNames.map((name) => [name, fs.readFileSync(path.join(root, name), "utf8")]));

// Return the attribute value from a matched HTML tag.
function attributeValue(attributes, name) {
	const match = attributes.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, "i"));
	return match ? match[1] : "";
}

// Resolve every local link and fragment to an authored page element.
test("all local page links and fragments resolve", () => {
	for (const [pageName, source] of pages) {
		const links = source.matchAll(/\bhref=["']([^"']+)["']/gi);
		for (const [, rawHref] of links) {
			const href = rawHref.replaceAll("&amp;", "&");
			if (/^(?:https?:|mailto:|tel:|javascript:)/i.test(href)) continue;

			const target = new URL(href, `https://local.invalid/${pageName}`);
			const targetName = decodeURIComponent(target.pathname.split("/").pop()) || "index.html";
			const targetPath = path.resolve(root, decodeURIComponent(target.pathname.slice(1)));
			assert.ok(pages.has(targetName) || fs.existsSync(targetPath), `${pageName} links to missing local file ${href}`);

			if (target.hash) {
				const targetSource = pages.get(targetName);
				const id = decodeURIComponent(target.hash.slice(1));
				assert.match(targetSource, new RegExp(`\\bid=["']${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']`), `${pageName} links to missing anchor ${href}`);
			}
		}
	}
});

// Keep the owner's supplied logo visible throughout the shared site shell.
test("every page uses the supplied GameSparks logo in its header and footer", () => {
	for (const [pageName, source] of pages) {
		assert.match(source, /<header\b[\s\S]*?<img\b[^>]*class=["']site-logo["'][^>]*src=["']assets\/images\/gamesparks-logo\.png["']/i, `${pageName} needs the supplied logo in its header`);
		assert.match(source, /<footer\b[\s\S]*?<img\b[^>]*class=["']site-logo["'][^>]*src=["']assets\/images\/gamesparks-logo\.png["']/i, `${pageName} needs the supplied logo in its footer`);
	}
	const home = pages.get("index.html");
	const styles = fs.readFileSync(path.join(root, "style.css"), "utf8");
	assert.match(home, /Nyan, a cat hero from Horde Survivor Arena 3D/i);
	assert.match(home, /class=["']hero-brand-sticker["'][^>]*>[\s\S]*?src=["']assets\/images\/gamesparks-logo\.png["']/i);
	assert.match(styles, /\.hero-brand-sticker\s*\{[^}]*width:\s*34%/s);
	assert.match(styles, /@media\s*\(min-width:\s*761px\)\s*and\s*\(max-width:\s*940px\)/i);
});

// Require readable page metadata and descriptive alternative text for authored images.
test("pages provide metadata and every image has an alternative text", () => {
	for (const [pageName, source] of pages) {
		assert.match(source, /<meta\s+name=["']viewport["']/i, `${pageName} needs a viewport declaration`);
		assert.match(source, /<meta\s+name=["']description["']/i, `${pageName} needs a description`);
		assert.match(source, /<title>[^<]+<\/title>/i, `${pageName} needs a title`);

		for (const [, attributes] of source.matchAll(/<img\b([^>]*)>/gi)) {
			const alt = attributeValue(attributes, "alt");
			assert.ok(alt.trim(), `${pageName} has an image without alternative text`);
			const src = attributeValue(attributes, "src");
			assert.ok(src && fs.existsSync(path.resolve(root, src)), `${pageName} has a missing image ${src}`);
		}
	}
});

// Keep the site usable on phones and avoid adding third-party trackers.
test("the site keeps mobile and privacy constraints in source", () => {
	const styles = fs.readFileSync(path.join(root, "style.css"), "utf8");
	const scripts = fs.readFileSync(path.join(root, "script.js"), "utf8");
	const siteSource = `${[...pages.values()].join("\n")}\n${scripts}`;

	assert.match(styles, /@media\s*\(max-width:\s*760px\)/i);
	assert.match(styles, /@media\s*\(prefers-reduced-motion:\s*reduce\)/i);
	assert.doesNotMatch(siteSource, /googletagmanager|google-analytics|facebook\.net\/tr|hotjar/i);
});

// Disclose that some crash services retain reports locally until players opt in.
test("the privacy policy explains optional crash reporting and deferred uploads", () => {
	const privacy = pages.get("privacy.html");
	assert.match(privacy, /Crash diagnostics[\s\S]*?if a game offers crash reporting[\s\S]*?optional/i);
	assert.match(privacy, /keep reports recorded while sharing is off on the device and upload them if you later enable reporting/i);
});
