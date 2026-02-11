// ==UserScript==
// @name         ChatGPT Deep Research Markdown Exporter
// @namespace    https://github.com/ckep1/chatgpt-research-export
// @version      2.1.1
// @description  Export ChatGPT conversations and deep research content as markdown with configurable citation styles
// @author       Chris Kephart
// @match        https://chatgpt.com/*
// @match        https://chat.openai.com/*
// @match        https://*.web-sandbox.oaiusercontent.com/*
// @grant        GM_getValue
// @grant        GM_setValue
// @run-at       document-idle
// @license      MIT
// ==/UserScript==

(function () {
  "use strict";

  // ============================================================================
  // CONTEXT DETECTION
  // ============================================================================

  const IS_IFRAME_CONTEXT = window.location.hostname.includes("web-sandbox.oaiusercontent.com");

  // ============================================================================
  // CONFIGURATION & CONSTANTS
  // ============================================================================

  const CITATION_STYLES = {
    ENDNOTES: "endnotes",
    FOOTNOTES: "footnotes",
    INLINE: "inline",
    PARENTHESIZED: "parenthesized",
    NAMED: "named",
    NONE: "none",
  };

  const CITATION_STYLE_DESCRIPTIONS = {
    [CITATION_STYLES.ENDNOTES]: "[1] in text with sources listed at the end",
    [CITATION_STYLES.FOOTNOTES]: "[^1] in text with footnote definitions at the end",
    [CITATION_STYLES.INLINE]: "[1](url) - Clean inline citations",
    [CITATION_STYLES.PARENTHESIZED]: "([1](url)) - Inline citations in parentheses",
    [CITATION_STYLES.NAMED]: "([wikipedia](url)) - Parenthesized domain names",
    [CITATION_STYLES.NONE]: "Remove all citations from the text",
  };

  const EXPORT_METHODS = {
    DOWNLOAD: "download",
    CLIPBOARD: "clipboard",
  };

  const ACCENT_COLOR = "#78c6f0";

  const globalCitations = {
    urlToNumber: new Map(),
    citationRefs: new Map(),
    nextCitationNumber: 1,

    reset() {
      this.urlToNumber.clear();
      this.citationRefs.clear();
      this.nextCitationNumber = 1;
    },

    addCitation(url, sourceName = null) {
      const normalizedUrl = normalizeUrl(url);
      if (!this.urlToNumber.has(normalizedUrl)) {
        this.urlToNumber.set(normalizedUrl, this.nextCitationNumber);
        this.citationRefs.set(this.nextCitationNumber, {
          href: url,
          sourceName,
          normalizedUrl,
        });
        this.nextCitationNumber++;
      }
      return this.urlToNumber.get(normalizedUrl);
    },
  };

  // ============================================================================
  // UTILITY FUNCTIONS
  // ============================================================================

  function getPreferences() {
    // GM_getValue may not be available in cross-origin iframe contexts
    const getter = typeof GM_getValue === "function" ? GM_getValue : (_, def) => def;
    return {
      citationStyle: getter("citationStyle", CITATION_STYLES.PARENTHESIZED),
      addExtraNewlines: getter("addExtraNewlines", false),
      exportMethod: getter("exportMethod", EXPORT_METHODS.DOWNLOAD),
      includeFrontmatter: getter("includeFrontmatter", true),
      titleAsH1: getter("titleAsH1", false),
    };
  }

  function normalizeUrl(url) {
    if (!url) return null;
    try {
      const urlObj = new URL(url);
      urlObj.hash = "";
      return urlObj.toString();
    } catch (e) {
      return url.split("#")[0];
    }
  }

  function extractDomainName(url) {
    if (!url) return null;
    try {
      const urlObj = new URL(url);
      let domain = urlObj.hostname.toLowerCase().replace(/^www\./, "");
      const parts = domain.split(".");
      if (parts.length >= 2) {
        if (parts[parts.length - 2].length <= 3 && parts.length > 2) {
          return parts[parts.length - 3];
        }
        return parts[parts.length - 2];
      }
      return parts[0];
    } catch (e) {
      return null;
    }
  }

  function cleanTitle() {
    return document.title
      .replace(/ \| ChatGPT$/, "")
      .replace(/ - ChatGPT$/, "")
      .trim() || "ChatGPT";
  }

  function makeSafeFilename(title) {
    return title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim()
      .replace(/\s+/g, "-")
      .replace(/^-+|-+$/g, "");
  }

  // ============================================================================
  // TITLE & CONTENT EXTRACTION
  // ============================================================================

  function extractResearchTitle(overrideTitle) {
    if (overrideTitle) return overrideTitle;
    const container = document.querySelector(".deep-research-result");
    if (container) {
      const h1 = container.querySelector("h1");
      if (h1) return h1.textContent.trim();
    }
    return cleanTitle() || "ChatGPT Research";
  }

  function hasDeepResearch() {
    return !!document.querySelector(".deep-research-result") ||
      !!document.querySelector('iframe[title="internal://deep-research"]');
  }

  function extractResearchContent() {
    // Try legacy .deep-research-result first
    const container = document.querySelector(".deep-research-result");
    if (container) {
      const prefs = getPreferences();
      globalCitations.reset();

      const markdown = htmlToMarkdown(container, prefs.citationStyle);
      if (!markdown || !markdown.trim()) return null;

      return formatResearchDocument(markdown.trim());
    }

    // If no legacy container, check for cross-origin iframe
    const iframe = document.querySelector('iframe[title="internal://deep-research"]');
    if (iframe) {
      // This path is async - handled by extractResearchFromIframe()
      return null;
    }

    return null;
  }

  function extractResearchFromIframe() {
    return new Promise((resolve) => {
      const iframe = document.querySelector('iframe[title="internal://deep-research"]');
      if (!iframe || !iframe.contentWindow) {
        resolve(null);
        return;
      }

      const prefs = getPreferences();
      let responded = false;

      function handleResponse(event) {
        if (responded) return;
        if (!event.data || event.data.type !== "chatgpt-export-response") return;
        responded = true;
        window.removeEventListener("message", handleResponse);

        const { markdown, title, citations } = event.data;

        if (!markdown || !markdown.trim()) {
          resolve(null);
          return;
        }

        // Restore citation state from iframe data
        globalCitations.reset();
        if (citations) {
          for (const [numStr, data] of Object.entries(citations)) {
            const num = parseInt(numStr, 10);
            globalCitations.urlToNumber.set(data.normalizedUrl, num);
            globalCitations.citationRefs.set(num, data);
            if (num >= globalCitations.nextCitationNumber) {
              globalCitations.nextCitationNumber = num + 1;
            }
          }
        }

        resolve(formatResearchDocument(markdown.trim(), title));
      }

      window.addEventListener("message", handleResponse);

      iframe.contentWindow.postMessage({
        type: "chatgpt-export-request",
        citationStyle: prefs.citationStyle,
      }, "*");

      // Timeout after 10 seconds
      setTimeout(() => {
        if (!responded) {
          responded = true;
          window.removeEventListener("message", handleResponse);
          resolve(null);
        }
      }, 10000);
    });
  }

  function extractConversationContent() {
    const turns = document.querySelectorAll('article[data-testid^="conversation-turn"]');
    if (!turns.length) return null;

    const prefs = getPreferences();
    globalCitations.reset();

    const parts = [];

    turns.forEach((article) => {
      const userEl = article.querySelector('[data-message-author-role="user"]');
      const assistantEl = article.querySelector('[data-message-author-role="assistant"]');

      if (userEl) {
        const textEl = userEl.querySelector("div.whitespace-pre-wrap");
        if (textEl) {
          const text = textEl.textContent.trim();
          if (text) {
            parts.push(`**User:** ${text}`);
          }
        }
      } else if (assistantEl) {
        const markdownEls = assistantEl.querySelectorAll("div.markdown");
        if (markdownEls.length > 0) {
          const sectionParts = [];
          markdownEls.forEach((el) => {
            const md = htmlToMarkdown(el, prefs.citationStyle);
            if (md && md.trim()) {
              sectionParts.push(md.trim());
            }
          });
          if (sectionParts.length > 0) {
            parts.push(`**Assistant:** ${sectionParts.join("\n\n")}`);
          }
        }
      }
    });

    if (!parts.length) return null;

    const content = parts.join("\n\n---\n\n");
    return formatConversationDocument(content);
  }

  // ============================================================================
  // HTML TO MARKDOWN CONVERSION
  // ============================================================================

  function htmlToMarkdown(rootElement, citationStyle, citationUrlMap) {
    const prefs = getPreferences();

    function processNode(node) {
      if (node.nodeType === Node.TEXT_NODE) {
        return node.textContent.replace(/\$/g, "\\$");
      }
      if (node.nodeType !== Node.ELEMENT_NODE) {
        return "";
      }

      const tag = node.tagName.toLowerCase();

      if (tag === "span" && node.getAttribute("data-state") === "closed") {
        return processCitationSpan(node, citationStyle);
      }

      if (tag === "a" && node.getAttribute("href")) {
        if (node.closest('span[data-state="closed"]')) {
          return "";
        }
        const href = node.getAttribute("href");
        const text = processChildren(node);

        // Detect citation links: numeric text inside <sup> (iframe deep research format)
        const inSup = node.parentElement && node.parentElement.tagName.toLowerCase() === "sup";
        if (inSup && /^\d+$/.test(text.trim())) {
          const num = globalCitations.addCitation(href);
          const domain = extractDomainName(href) || "source";
          if (citationStyle === CITATION_STYLES.NONE) return "";
          if (citationStyle === CITATION_STYLES.ENDNOTES) return `[${num}]`;
          if (citationStyle === CITATION_STYLES.FOOTNOTES) return `[^${num}]`;
          if (citationStyle === CITATION_STYLES.INLINE) return `[${num}](${href})`;
          if (citationStyle === CITATION_STYLES.PARENTHESIZED) return `([${num}](${href}))`;
          if (citationStyle === CITATION_STYLES.NAMED) return `([${domain}](${href}))`;
          return `[${num}]`;
        }

        if (citationStyle === CITATION_STYLES.NONE) {
          return text;
        }
        return `[${text}](${href})`;
      }

      const children = processChildren(node);

      switch (tag) {
        case "h1":
          return `# ${children.trim()}\n\n`;
        case "h2":
          return `## ${children.trim()}\n\n`;
        case "h3":
          return `### ${children.trim()}\n\n`;
        case "h4":
          return `#### ${children.trim()}\n\n`;
        case "h5":
          return `##### ${children.trim()}\n\n`;
        case "h6":
          return `###### ${children.trim()}\n\n`;
        case "p":
          return `${children.trim()}\n\n`;
        case "strong":
        case "b":
          return `**${children}**`;
        case "em":
        case "i":
          return `*${children}*`;
        case "ul":
          return `${children}\n`;
        case "ol":
          return processOrderedList(node);
        case "li":
          return processListItem(node);
        case "blockquote":
          return processBlockquote(children);
        case "code":
          if (node.parentElement && node.parentElement.tagName.toLowerCase() === "pre") {
            return children;
          }
          return `\`${children}\``;
        case "pre":
          return processPreBlock(node);
        case "br":
          return "\n";
        case "table":
          return processTable(node);
        case "thead":
        case "tbody":
        case "tr":
        case "th":
        case "td":
          return children;
        case "hr":
          return "\n---\n\n";
        case "svg":
        case "path":
          return "";
        case "sup": {
          const supText = children.trim();
          if (/^\d+$/.test(supText) && citationUrlMap) {
            const urls = citationUrlMap.get(node);
            if (urls && urls.length > 0) {
              if (citationStyle === CITATION_STYLES.NONE) return "";
              const parts = urls.map((url) => {
                const num = globalCitations.addCitation(url);
                const domain = extractDomainName(url) || "source";
                if (citationStyle === CITATION_STYLES.ENDNOTES) return `[${num}]`;
                if (citationStyle === CITATION_STYLES.FOOTNOTES) return `[^${num}]`;
                if (citationStyle === CITATION_STYLES.INLINE) return `[${num}](${url})`;
                if (citationStyle === CITATION_STYLES.PARENTHESIZED) return `([${num}](${url}))`;
                if (citationStyle === CITATION_STYLES.NAMED) return `([${domain}](${url}))`;
                return `[${num}]`;
              });
              return parts.join("");
            }
            return `[${supText}]`;
          }
          return children;
        }
        case "div":
        case "section":
        case "article":
        case "span":
          return children;
        default:
          return children;
      }
    }

    function processChildren(node) {
      let result = "";
      for (const child of node.childNodes) {
        result += processNode(child);
      }
      return result;
    }

    function processCitationSpan(span, style) {
      const link = span.querySelector("a[href]");
      if (!link) return "";

      const href = link.getAttribute("href");
      if (!href) return "";

      const num = globalCitations.addCitation(href);
      const domain = extractDomainName(href) || "source";

      if (style === CITATION_STYLES.NONE) return "";
      if (style === CITATION_STYLES.ENDNOTES) return `[${num}]`;
      if (style === CITATION_STYLES.FOOTNOTES) return `[^${num}]`;
      if (style === CITATION_STYLES.INLINE) return `[${num}](${href})`;
      if (style === CITATION_STYLES.PARENTHESIZED) return `([${num}](${href}))`;
      if (style === CITATION_STYLES.NAMED) return `([${domain}](${href}))`;
      return `[${num}]`;
    }

    function processListItem(node) {
      const parent = node.parentElement;
      if (parent && parent.tagName.toLowerCase() === "ol") {
        const items = Array.from(parent.children).filter((c) => c.tagName.toLowerCase() === "li");
        const index = items.indexOf(node) + 1;
        return `${index}. ${processChildren(node).trim()}\n`;
      }
      return `- ${processChildren(node).trim()}\n`;
    }

    function processOrderedList(node) {
      return processChildren(node) + "\n";
    }

    function processBlockquote(content) {
      const lines = content.trim().split("\n");
      return lines.map((line) => `> ${line}`).join("\n") + "\n\n";
    }

    function processPreBlock(node) {
      const codeEl = node.querySelector("code");
      let language = "";
      if (codeEl) {
        const classList = Array.from(codeEl.classList);
        const langClass = classList.find((c) => c.startsWith("language-") || c.startsWith("lang-"));
        if (langClass) {
          language = langClass.replace(/^(language-|lang-)/, "");
        }
      }
      const text = codeEl ? codeEl.textContent : node.textContent;
      return `\`\`\`${language}\n${text}\n\`\`\`\n\n`;
    }

    function processTable(tableNode) {
      const rows = [];
      const headerRows = tableNode.querySelectorAll("thead tr");
      if (headerRows.length > 0) {
        headerRows.forEach((row) => {
          const cells = Array.from(row.querySelectorAll("th, td")).map((cell) => processChildren(cell).replace(/\n/g, " ").trim() || " ");
          if (cells.length > 0) {
            rows.push(`| ${cells.join(" | ")} |`);
            rows.push(`| ${cells.map(() => "---").join(" | ")} |`);
          }
        });
      }
      const bodyRows = tableNode.querySelectorAll("tbody tr");
      bodyRows.forEach((row) => {
        const cells = Array.from(row.querySelectorAll("td")).map((cell) => processChildren(cell).replace(/\n/g, " ").trim() || " ");
        if (cells.length > 0) {
          rows.push(`| ${cells.join(" | ")} |`);
        }
      });
      return rows.length > 0 ? `\n${rows.join("\n")}\n\n` : "";
    }

    let text = processNode(rootElement);

    text = text.replace(/\n{3,}/g, "\n\n");
    if (!prefs.addExtraNewlines) {
      text = text.replace(/\n\n/g, "\n");
    }

    text = text.replace(/[ \t]+$/gm, "").trim();

    return text;
  }

  // ============================================================================
  // DOCUMENT FORMATTING
  // ============================================================================

  function buildFrontmatter(title) {
    const timestamp = new Date().toISOString().split("T")[0];
    let fm = "---\n";
    fm += `title: ${title}\n`;
    fm += `date: ${timestamp}\n`;
    fm += `source: ${window.location.href}\n`;
    fm += "---\n\n";
    return fm;
  }

  function appendCitationEndnotes(markdown) {
    const prefs = getPreferences();

    if (prefs.citationStyle === CITATION_STYLES.ENDNOTES && globalCitations.citationRefs.size > 0) {
      markdown += "\n\n### Sources\n";
      for (const [number, { href }] of globalCitations.citationRefs) {
        markdown += `\n[${number}] ${href}`;
      }
      markdown += "\n";
    }

    if (prefs.citationStyle === CITATION_STYLES.FOOTNOTES && globalCitations.citationRefs.size > 0) {
      markdown += "\n\n";
      for (const [number, { href }] of globalCitations.citationRefs) {
        markdown += `[^${number}]: ${href}\n`;
      }
    }

    return markdown;
  }

  function formatResearchDocument(content, overrideTitle) {
    const title = extractResearchTitle(overrideTitle);
    const prefs = getPreferences();

    let markdown = "";

    if (prefs.includeFrontmatter) {
      markdown += buildFrontmatter(title);
    }

    if (prefs.titleAsH1) {
      markdown += `# ${title}\n\n`;
    }

    markdown += content;
    markdown = appendCitationEndnotes(markdown);

    return markdown.trim();
  }

  function formatConversationDocument(content) {
    const title = cleanTitle();
    const prefs = getPreferences();

    let markdown = "";

    if (prefs.includeFrontmatter) {
      markdown += buildFrontmatter(title);
    }

    if (prefs.titleAsH1) {
      markdown += `# ${title}\n\n`;
    }

    markdown += content;
    markdown = appendCitationEndnotes(markdown);

    return markdown.trim();
  }

  // ============================================================================
  // EXPORT FUNCTIONS
  // ============================================================================

  function downloadMarkdown(content, filename) {
    const blob = new Blob([content], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  async function copyToClipboard(content) {
    try {
      await navigator.clipboard.writeText(content);
      return true;
    } catch (err) {
      return false;
    }
  }

  async function doExportAsync(extractFn, filenameSuffix, button) {
    const originalText = button.textContent;
    button.textContent = "Exporting...";
    button.disabled = true;

    try {
      const markdown = await extractFn();
      if (!markdown) {
        alert("No content found to export. The iframe may not have responded.");
        return;
      }

      const prefs = getPreferences();

      if (prefs.exportMethod === EXPORT_METHODS.CLIPBOARD) {
        const success = await copyToClipboard(markdown);
        if (success) {
          button.textContent = "Copied!";
          setTimeout(() => {
            button.textContent = originalText;
          }, 2000);
          return;
        } else {
          alert("Failed to copy to clipboard. Please try again.");
        }
      } else {
        const title = cleanTitle();
        const safeTitle = makeSafeFilename(title);
        const filename = `${safeTitle || "chatgpt"}-${filenameSuffix}.md`;
        downloadMarkdown(markdown, filename);
      }
    } catch (error) {
      alert("Export failed. Please try again.");
    } finally {
      if (button.textContent !== "Copied!") {
        button.textContent = originalText;
      }
      button.disabled = false;
    }
  }

  async function doExport(extractFn, filenameSuffix, button) {
    const originalText = button.textContent;
    button.textContent = "Exporting...";
    button.disabled = true;

    try {
      const markdown = extractFn();
      if (!markdown) {
        alert("No content found to export.");
        return;
      }

      const prefs = getPreferences();

      if (prefs.exportMethod === EXPORT_METHODS.CLIPBOARD) {
        const success = await copyToClipboard(markdown);
        if (success) {
          button.textContent = "Copied!";
          setTimeout(() => {
            button.textContent = originalText;
          }, 2000);
          return;
        } else {
          alert("Failed to copy to clipboard. Please try again.");
        }
      } else {
        const title = cleanTitle();
        const safeTitle = makeSafeFilename(title);
        const filename = `${safeTitle || "chatgpt"}-${filenameSuffix}.md`;
        downloadMarkdown(markdown, filename);
      }
    } catch (error) {
      alert("Export failed. Please try again.");
    } finally {
      if (button.textContent !== "Copied!") {
        button.textContent = originalText;
      }
      button.disabled = false;
    }
  }

  // ============================================================================
  // UI
  // ============================================================================

  let conversationBtn = null;
  let researchBtn = null;
  let optionsBtn = null;
  let optionsMenu = null;
  let controlsContainer = null;
  let closeMenuFn = null;

  function makeButton(text) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = text;
    btn.style.cssText = `
      padding: 4px 8px;
      background-color: ${ACCENT_COLOR};
      color: black;
      border: none;
      border-radius: 8px;
      cursor: pointer;
      font-size: 12px;
      font-weight: 600;
      transition: background-color 0.2s;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
      white-space: nowrap;
    `;
    return btn;
  }

  function buildUI() {
    const existing = document.getElementById("chatgpt-export-controls");
    if (existing) existing.remove();

    const container = document.createElement("div");
    container.id = "chatgpt-export-controls";
    container.style.cssText = `
      position: fixed;
      left: 50%;
      transform: translateX(-50%);
      display: flex;
      gap: 8px;
      align-items: stretch;
      z-index: 99999;
      font-family: inherit;
    `;
    controlsContainer = container;

    // Conversation button
    conversationBtn = makeButton("");
    conversationBtn.id = "chatgpt-export-conversation-btn";
    conversationBtn.style.display = "none";
    conversationBtn.addEventListener("click", () => {
      doExport(extractConversationContent, "conversation", conversationBtn);
      if (closeMenuFn) closeMenuFn();
    });

    // Research button
    researchBtn = makeButton("");
    researchBtn.id = "chatgpt-export-research-btn";
    researchBtn.style.display = "none";
    researchBtn.addEventListener("click", () => {
      // Check if research is in a cross-origin iframe
      const iframe = document.querySelector('iframe[title="internal://deep-research"]');
      if (iframe && !document.querySelector(".deep-research-result")) {
        doExportAsync(extractResearchFromIframe, "research", researchBtn);
      } else {
        doExport(extractResearchContent, "research", researchBtn);
      }
      if (closeMenuFn) closeMenuFn();
    });

    // Options button + menu wrapper
    const optionsWrapper = document.createElement("div");
    optionsWrapper.style.cssText = "position: relative; display: flex;";

    optionsBtn = makeButton("Options");
    optionsBtn.id = "chatgpt-export-options-btn";
    optionsBtn.setAttribute("aria-haspopup", "true");
    optionsBtn.setAttribute("aria-expanded", "false");
    optionsBtn.style.display = "none";

    const menu = document.createElement("div");
    menu.id = "chatgpt-export-options-menu";
    menu.style.cssText = `
      position: absolute;
      bottom: calc(100% + 8px);
      left: 50%;
      transform: translateX(-50%);
      display: none;
      flex-direction: column;
      gap: 10px;
      min-width: 280px;
      background: #1F2121;
      color: white;
      border-radius: 12px;
      padding: 12px;
      box-shadow: 0 12px 24px rgba(0, 0, 0, 0.25);
    `;
    optionsMenu = menu;

    function openMenu() {
      renderOptionsMenu();
      menu.style.display = "flex";
      optionsBtn.setAttribute("aria-expanded", "true");
      document.addEventListener("mousedown", handleOutsideClick, true);
      document.addEventListener("keydown", handleEscapeKey, true);
    }

    function closeMenu() {
      menu.style.display = "none";
      optionsBtn.setAttribute("aria-expanded", "false");
      document.removeEventListener("mousedown", handleOutsideClick, true);
      document.removeEventListener("keydown", handleEscapeKey, true);
    }
    closeMenuFn = closeMenu;

    function toggleMenu() {
      if (menu.style.display === "none" || menu.style.display === "") {
        openMenu();
      } else {
        closeMenu();
      }
    }

    function handleOutsideClick(event) {
      if (!menu.contains(event.target) && !optionsBtn.contains(event.target)) {
        closeMenu();
      }
    }

    function handleEscapeKey(event) {
      if (event.key === "Escape") {
        closeMenu();
      }
    }

    optionsBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      toggleMenu();
    });

    optionsWrapper.appendChild(optionsBtn);

    container.appendChild(conversationBtn);
    container.appendChild(researchBtn);
    container.appendChild(optionsWrapper);
    container.appendChild(menu);

    document.body.appendChild(container);

    positionAboveComposer();
    window.addEventListener("resize", positionAboveComposer);
    if (typeof ResizeObserver !== "undefined") {
      const form = document.querySelector('form[data-type="unified-composer"]');
      if (form) new ResizeObserver(positionAboveComposer).observe(form);
    }
    setInterval(positionAboveComposer, 2000);

    updateButtonLabels();
    refreshButtons();
  }

  function positionAboveComposer() {
    if (!controlsContainer) return;
    const form = document.querySelector('form[data-type="unified-composer"]');
    if (form) {
      const rect = form.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      controlsContainer.style.bottom = `${window.innerHeight - rect.top + 8}px`;
      controlsContainer.style.left = `${centerX}px`;
    } else {
      controlsContainer.style.bottom = "40px";
      controlsContainer.style.left = "50%";
    }
  }

  function updateButtonLabels() {
    const prefs = getPreferences();
    const isClipboard = prefs.exportMethod === EXPORT_METHODS.CLIPBOARD;
    if (conversationBtn) {
      conversationBtn.textContent = isClipboard ? "Copy Conversation as Markdown" : "Save Conversation as Markdown";
    }
    if (researchBtn) {
      researchBtn.textContent = isClipboard ? "Copy Research as Markdown" : "Save Research as Markdown";
    }
  }

  function refreshButtons() {
    if (!controlsContainer) return;

    const hasTurns = document.querySelectorAll('article[data-testid^="conversation-turn"]').length > 0;
    const hasResearch = hasDeepResearch();
    const showAny = hasTurns || hasResearch;

    conversationBtn.style.display = hasTurns ? "" : "none";
    researchBtn.style.display = hasResearch ? "" : "none";
    optionsBtn.style.display = showAny ? "" : "none";
    controlsContainer.style.display = showAny ? "flex" : "none";
  }

  function createOptionButton(label, value, currentValue, onSelect, tooltip) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = label;
    if (tooltip) btn.setAttribute("title", tooltip);
    const isActive = value === currentValue;
    btn.style.cssText = `
      padding: 6px 8px;
      border-radius: 6px;
      border: 1px solid ${isActive ? ACCENT_COLOR : "#4a5568"};
      background-color: ${isActive ? ACCENT_COLOR : "#2d3748"};
      color: ${isActive ? "#0a0e13" : "#f7fafc"};
      font-size: 11px;
      text-align: center;
      cursor: pointer;
      transition: background-color 0.2s, border-color 0.2s, color 0.2s;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    `;
    btn.addEventListener("mouseenter", () => {
      if (value !== currentValue) {
        btn.style.borderColor = ACCENT_COLOR;
        btn.style.backgroundColor = "#4a5568";
      }
    });
    btn.addEventListener("mouseleave", () => {
      if (value !== currentValue) {
        btn.style.borderColor = "#4a5568";
        btn.style.backgroundColor = "#2d3748";
      }
    });
    btn.addEventListener("click", () => {
      onSelect(value);
      renderOptionsMenu();
      updateButtonLabels();
    });
    return btn;
  }

  function appendOptionGroup(sectionEl, label, options, currentValue, onSelect, labelTooltip) {
    const group = document.createElement("div");
    group.style.cssText = "display: flex; flex-direction: column; gap: 6px;";

    if (label) {
      const groupLabel = document.createElement("div");
      groupLabel.textContent = label;
      groupLabel.style.cssText = "font-size: 12px; font-weight: 600; color: #d1d5db;";
      if (labelTooltip) {
        groupLabel.setAttribute("title", labelTooltip);
        groupLabel.style.cursor = "help";
      }
      group.appendChild(groupLabel);
    }

    const list = document.createElement("div");
    list.style.cssText = "display: grid; grid-template-columns: 1fr 1fr; gap: 4px;";

    options.forEach((opt) => {
      list.appendChild(createOptionButton(opt.label, opt.value, currentValue, onSelect, opt.tooltip));
    });

    group.appendChild(list);
    sectionEl.appendChild(group);
  }

  function renderOptionsMenu() {
    if (!optionsMenu) return;
    const prefs = getPreferences();
    optionsMenu.innerHTML = "";

    const citationSection = document.createElement("div");
    citationSection.style.cssText = "display: flex; flex-direction: column; gap: 6px;";
    const citationHeading = document.createElement("div");
    citationHeading.textContent = "Citation Style";
    citationHeading.style.cssText = "font-size: 13px; font-weight: 700; color: #f9fafb;";
    citationSection.appendChild(citationHeading);

    appendOptionGroup(
      citationSection,
      "Format",
      [
        { label: "Endnotes", value: CITATION_STYLES.ENDNOTES, tooltip: CITATION_STYLE_DESCRIPTIONS[CITATION_STYLES.ENDNOTES] },
        { label: "Footnotes", value: CITATION_STYLES.FOOTNOTES, tooltip: CITATION_STYLE_DESCRIPTIONS[CITATION_STYLES.FOOTNOTES] },
        { label: "Inline", value: CITATION_STYLES.INLINE, tooltip: CITATION_STYLE_DESCRIPTIONS[CITATION_STYLES.INLINE] },
        { label: "Parenthesized", value: CITATION_STYLES.PARENTHESIZED, tooltip: CITATION_STYLE_DESCRIPTIONS[CITATION_STYLES.PARENTHESIZED] },
        { label: "Named", value: CITATION_STYLES.NAMED, tooltip: CITATION_STYLE_DESCRIPTIONS[CITATION_STYLES.NAMED] },
        { label: "No Citations", value: CITATION_STYLES.NONE, tooltip: CITATION_STYLE_DESCRIPTIONS[CITATION_STYLES.NONE] },
      ],
      prefs.citationStyle,
      (next) => GM_setValue("citationStyle", next)
    );
    optionsMenu.appendChild(citationSection);

    const outputSection = document.createElement("div");
    outputSection.style.cssText = "display: flex; flex-direction: column; gap: 6px;";
    const outputHeading = document.createElement("div");
    outputHeading.textContent = "Output Style";
    outputHeading.style.cssText = "font-size: 13px; font-weight: 700; color: #f9fafb;";
    outputSection.appendChild(outputHeading);

    appendOptionGroup(
      outputSection,
      "Spacing",
      [
        { label: "Standard", value: false },
        { label: "Extra newlines", value: true },
      ],
      prefs.addExtraNewlines,
      (next) => GM_setValue("addExtraNewlines", next)
    );

    appendOptionGroup(
      outputSection,
      "Frontmatter",
      [
        { label: "Include", value: true, tooltip: "Include YAML metadata (title, date, source URL) at the top" },
        { label: "Exclude", value: false, tooltip: "Export just the content without metadata" },
      ],
      prefs.includeFrontmatter,
      (next) => GM_setValue("includeFrontmatter", next),
      "YAML metadata section at the top with title, date, and source URL"
    );

    appendOptionGroup(
      outputSection,
      "Title as H1",
      [
        { label: "Include", value: true, tooltip: "Add the research title as a level 1 heading" },
        { label: "Exclude", value: false, tooltip: "Don't add title as heading (use frontmatter only)" },
      ],
      prefs.titleAsH1,
      (next) => GM_setValue("titleAsH1", next),
      "Add the research title as a # heading at the top"
    );

    optionsMenu.appendChild(outputSection);

    const exportSection = document.createElement("div");
    exportSection.style.cssText = "display: flex; flex-direction: column; gap: 6px;";
    const exportHeading = document.createElement("div");
    exportHeading.textContent = "Export Options";
    exportHeading.style.cssText = "font-size: 13px; font-weight: 700; color: #f9fafb;";
    exportSection.appendChild(exportHeading);

    appendOptionGroup(
      exportSection,
      "Output Method",
      [
        { label: "Download File", value: EXPORT_METHODS.DOWNLOAD },
        { label: "Copy to Clipboard", value: EXPORT_METHODS.CLIPBOARD },
      ],
      prefs.exportMethod,
      (next) => GM_setValue("exportMethod", next)
    );

    optionsMenu.appendChild(exportSection);
  }

  // ============================================================================
  // CITATION URL EXTRACTION (React fiber traversal for iframe content)
  // ============================================================================

  function extractCitationUrls(doc) {
    const map = new Map();
    const sups = doc.querySelectorAll("sup");
    const citationSups = [];

    for (const sup of sups) {
      const text = sup.textContent.trim();
      if (/^\d+$/.test(text)) citationSups.push(sup);
    }

    if (citationSups.length === 0) return map;

    // For each citation sup, resolve its URL(s) from React fiber item prop
    // Citations can reference multiple sources (nested/grouped citations)
    for (const sup of citationSups) {
      // Try the item prop from the citation's own fiber (level 2, sXn component)
      const fk = Object.keys(sup).find((k) => k.startsWith("__reactFiber"));
      if (fk) {
        let node = sup[fk];
        for (let i = 0; i < 5 && node; i++) {
          const props = node.memoizedProps || node.pendingProps;
          if (props && props.item) {
            const item = props.item;
            const urls = [];

            // Primary: item.reference.safe_urls (array of grouped URLs)
            if (item.reference && Array.isArray(item.reference.safe_urls)) {
              for (const u of item.reference.safe_urls) {
                if (typeof u === "string" && /^https?:\/\//.test(u)) {
                  urls.push(u.replace(/[?&]utm_source=chatgpt\.com/, ""));
                }
              }
            }

            // Fallback: item.url (single URL)
            if (urls.length === 0 && item.url) {
              urls.push(item.url.replace(/[?&]utm_source=chatgpt\.com/, ""));
            }

            const unique = [...new Set(urls)];
            if (unique.length > 0) { map.set(sup, unique); break; }
          }
          node = node.return;
        }
      }
    }

    return map;
  }

  // ============================================================================
  // IFRAME BRIDGE (runs inside the deep research sandbox iframe)
  // ============================================================================

  function initIframeBridge() {
    // The sandbox iframe contains a nested iframe with the actual content.
    // This nested iframe is same-origin and directly accessible.
    function getContentDocument() {
      const nested = document.querySelector("iframe");
      if (nested) {
        try {
          const doc = nested.contentDocument;
          if (doc && doc.body && doc.body.textContent.trim().length > 100) return doc;
        } catch (e) { /* cross-origin, fall through */ }
      }
      return document;
    }

    function findReportContainer() {
      const doc = getContentDocument();
      const candidates = ["main", "article", ".report", ".content"];
      for (const sel of candidates) {
        const el = doc.querySelector(sel);
        if (el && el.textContent.trim().length > 200) return el;
      }
      // Fallback: find the container with the most text content that has an h1
      const divs = doc.querySelectorAll("div");
      let best = null;
      let bestLen = 0;
      for (const div of divs) {
        const h1 = div.querySelector("h1");
        if (h1 && div.textContent.trim().length > bestLen) {
          bestLen = div.textContent.trim().length;
          best = div;
        }
      }
      return best || doc.body;
    }

    function extractTitle() {
      const doc = getContentDocument();
      const h1 = doc.querySelector("h1");
      return h1 ? h1.textContent.trim() : "ChatGPT Research";
    }

    function waitForContent() {
      return new Promise((resolve) => {
        function hasContent() {
          const doc = getContentDocument();
          return doc.querySelector("h1") && doc.body.textContent.trim().length > 200;
        }
        if (hasContent()) { resolve(); return; }
        // Poll for content (MutationObserver can't watch across iframe boundaries)
        const interval = setInterval(() => {
          if (hasContent()) { clearInterval(interval); resolve(); }
        }, 500);
        setTimeout(() => { clearInterval(interval); resolve(); }, 15000);
      });
    }

    waitForContent().then(() => {
      // Clean up temp element if present
      const tempLink = document.getElementById("__iframe_link");
      if (tempLink) tempLink.remove();

      window.addEventListener("message", (event) => {
        if (!event.data || event.data.type !== "chatgpt-export-request") return;

        const citationStyle = event.data.citationStyle || CITATION_STYLES.PARENTHESIZED;
        globalCitations.reset();

        const container = findReportContainer();
        const doc = getContentDocument();

        // Extract citation URLs from React fiber before converting to markdown
        const citationUrlMap = extractCitationUrls(doc);

        let markdown = htmlToMarkdown(container, citationStyle, citationUrlMap);

        // Strip pre-header metadata (SVG counter text, "Research completed..." line)
        const headingMatch = markdown.match(/^(#{1,6}\s)/m);
        if (headingMatch) {
          markdown = markdown.substring(markdown.indexOf(headingMatch[0]));
        }

        const title = extractTitle();

        // Collect citation data to send back to parent
        const citations = {};
        for (const [number, data] of globalCitations.citationRefs) {
          citations[number] = data;
        }

        window.parent.postMessage({
          type: "chatgpt-export-response",
          markdown: markdown || "",
          title,
          citations,
        }, "*");
      });
    });
  }

  // ============================================================================
  // INITIALIZATION
  // ============================================================================

  function init() {
    // If running inside the deep research iframe, set up the bridge and exit
    if (IS_IFRAME_CONTEXT) {
      initIframeBridge();
      return;
    }

    let lastUrl = location.href;

    buildUI();

    // MutationObserver for content changes within the current page
    const observer = new MutationObserver(() => {
      refreshButtons();
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });

    // URL change detection: popstate for back/forward
    window.addEventListener("popstate", () => {
      handleNavigation();
    });

    // Periodic URL check for client-side navigation that doesn't fire popstate
    setInterval(() => {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        handleNavigation();
      }
    }, 500);

    function handleNavigation() {
      lastUrl = location.href;
      // Remove existing UI and rebuild after content loads
      const existing = document.getElementById("chatgpt-export-controls");
      if (existing) existing.remove();
      controlsContainer = null;

      setTimeout(() => {
        buildUI();
      }, 800);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
