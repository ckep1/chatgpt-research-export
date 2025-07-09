# ChatGPT Deep Research Markdown Exporter

A Tampermonkey userscript that exports ChatGPT deep research content to clean markdown format with numbered citations.

## Features

- Converts ChatGPT deep research results to properly formatted markdown
- Replaces long URLs and page titles for sources with numbered citations (1), (2), etc. Accounts for multiple citations from the same base source.
- Provides both download and copy-to-clipboard functionality
- Optional frontmatter generation for note-taking apps (customize in the script if you'd like).
- Automatically adds export buttons when deep research content is detected

## Installation

1. Install [Tampermonkey](https://www.tampermonkey.net/) browser extension
2. Download the `chatgpt-research-export.user.js` file and open it in your browser to install, or install via Greasyfork.
3. Visit ChatGPT and run a deep research query

## Usage

When viewing deep research results on ChatGPT, two buttons will appear in the top-right corner:

- **Export Research (MD)** - Downloads the content as a markdown file
- **Copy Research (MD)** - Copies the content to your clipboard

### Frontmatter Toggle

Access the Tampermonkey menu to enable/disable frontmatter generation, which adds metadata headers useful for note-taking applications.

## How It Works

The script identifies deep research containers and converts HTML elements to their markdown equivalents. Long citation page titles or URLs are automatically converted to numbered references with clickable links, making research output much cleaner and more readable.

## Requirements

- Tampermonkey or compatible userscript manager
- Works on chatgpt.com and chat.openai.com

## License
MIT License, see attached file.