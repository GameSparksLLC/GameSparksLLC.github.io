const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = __dirname;
const pageNames = ["index.html", "terms.html", "privacy.html", "contact.html"];
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
test("every page uses the supplied navigation and footer logos", () => {
	for (const [pageName, source] of pages) {
		assert.match(source, /<header\b[\s\S]*?<img\b[^>]*class=["']site-logo["'][^>]*src=["']assets\/images\/gs-nav-icon\.webp["']/i, `${pageName} needs the supplied navigation logo`);
		assert.match(source, /<footer\b[\s\S]*?<img\b[^>]*class=["']site-logo["'][^>]*src=["']assets\/images\/gs-icon\.webp["']/i, `${pageName} needs the supplied footer icon`);
		assert.match(source, /<link\s+rel=["']icon["'][^>]*href=["']assets\/images\/gs-favicon\.png["']/i, `${pageName} needs the supplied favicon`);
	}
	const home = pages.get("index.html");
	const styles = fs.readFileSync(path.join(root, "style.css"), "utf8");
	assert.match(home, /<figure\s+class=["']hero-art["'][\s\S]*?<canvas\s+class=["']hero-art-canvas["']/i);
	assert.match(home, /<button\s+class=["']wireframe-toggle["']/i);
	assert.match(home, /<a\s+href=["']#top["']>Studio<\/a>/i);
	const imageSources = [...pages.values()].flatMap((source) => [...source.matchAll(/<img\b[^>]*\bsrc=["']([^"']+)["']/gi)].map(([, src]) => src));
	assert.ok(imageSources.every((src) => /\.webp$/i.test(src)), "general site images should use WebP");
	assert.match(styles, /\.site-header \.site-logo\s*\{[^}]*aspect-ratio:\s*2/s);
	assert.match(styles, /\.hero-art-controls\s*\{[^}]*align-self:\s*center/s);
	assert.doesNotMatch(styles, /\.hero-art-controls\s*\{[^}]*left:\s*-8\.8%/s);
	assert.match(styles, /\.hero-highlight\s*\{[^}]*background:\s*var\(--red\)/s);
	assert.match(styles, /\.hero-rotator\s*\{[^}]*transition:\s*width 480ms/s);
	assert.match(styles, /@media\s*\(min-width:\s*761px\)\s*and\s*\(max-width:\s*1259px\)/i);
});

// Require page metadata and an alt attribute on every image, allowing decorative images to use an empty value.
test("pages provide metadata and every image declares alternative text", () => {
	for (const [pageName, source] of pages) {
		assert.match(source, /<meta\s+name=["']viewport["']/i, `${pageName} needs a viewport declaration`);
		assert.match(source, /<meta\s+name=["']description["']/i, `${pageName} needs a description`);
		assert.match(source, /<title>[^<]+<\/title>/i, `${pageName} needs a title`);

		for (const [, attributes] of source.matchAll(/<img\b([^>]*)>/gi)) {
			assert.match(attributes, /\balt\s*=/i, `${pageName} has an image without an alt attribute`);
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

// Keep the policy's analytics disclosure general across GameSparks games.
test("the privacy policy describes general analytics collection", () => {
	const privacy = pages.get("privacy.html");
	assert.match(privacy, /<strong>Analytics and app quality:<\/strong> Where analytics is used, it collects general gameplay and feature-use events, coarse performance measurements, and standard app, device, and usage information\./i);
	assert.match(privacy, /Analytics do not collect direct player identifiers such as your name, email address, display name, or GameSparks account ID\./i);
	assert.match(privacy, /An analytics service may use a pseudonymous app-instance identifier that is not linked to your GameSparks account\./i);
	assert.match(privacy, /We do not ask for separate in-game approval for this general analytics information\./i);
	assert.doesNotMatch(privacy, /Horde Survivor Arena 3D sends|Firebase Analytics after Firebase initializes|Crashlytics/i);
});

// Keep crash-reporting language general rather than promising a specific provider or game behavior.
test("the privacy policy describes general crash diagnostics", () => {
	const privacy = pages.get("privacy.html");
	assert.match(privacy, /<strong>Crash diagnostics:<\/strong> Where crash diagnostics are used, services may process the app version, device and operating system details, and crash or error information to help identify and fix problems\./i);
	assert.doesNotMatch(privacy, /Horde Survivor Arena 3D uses Firebase Crashlytics|automatic crash reporting without a prompt/i);
});
