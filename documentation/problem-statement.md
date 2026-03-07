# Problem Statement:

All of the markdown editors in vs code .  They lack features, aren’t maintained, have some janky behavior that annoys me, and/or are abandoned.  The purpose of this project will be creating a useful VS Code Plugin I can use for maintaining code documentation and also for my personal notes.


# Architecture Decisions

I don’t want this to be a generic rich text editor.  Because I want to use it extensively in code repos, I want markdown specifically.  This is the primary driver behind using Milkdown.  I considered TipTap and some other things, but since I want to define some constraints here.  

The markdown file on the disk is the source of truth.  No man behind the curtain json or db

The goal here is to have the following feature set in VS Code:

- [ ] headings
- [ ] paragraphs
- [ ] bold/italic/strikethrough/code
- [ ] highlighting
- [ ] lists (ordered and unordered)
- [ ] links
- [ ] task lists
- [ ] blockquotes
- [ ] fenced code blocks
- [ ] tables
- [ ] images (copy and paste as the first class system, local storage)
- [ ] raw HTML blocks
- [ ] URL based video embeds
- [ ] collapsible by header


# User Stories

I’m not going to be full Johnny Agile on this project, but I will keep track of user stories for this thing.

## backlog (in order of priority)


---

Foundation

- [ ] Register a custom editor for Markdown files
- [ ] Create the webview shell and extension ↔ webview message flow
- [ ] Bootstrap Milkdown inside the webview
- [ ] Load Markdown content from disk into the editor
- [ ] Save editor content back to the Markdown file
- [ ] Set up local development workflow, build, and packaging

  
---

  Editor Capabilities
- [ ] Support headings, paragraphs, bold, italic, strikethrough, inline code, and links
- [ ] Support ordered lists, unordered lists, task lists, and blockquotes
- [ ] Support fenced code blocks and tables
- [ ] Support inline image rendering from Markdown image syntax
- [ ] Support inserting image URLs into the document
- [ ] Support local image asset insertion and workspace-relative paths
- [ ] Support URL-based video embeds with preview behavior
- [ ] Preserve raw HTML blocks during load/edit/save round trips

  
---

  Editor Experience
- [ ] Add keyboard shortcuts for common formatting actions
- [ ] Add slash commands for inserting common block types
- [ ] Improve paste behavior for plain text, Markdown, links, and media URLs
- [ ] Integrate with VS Code light/dark themes
- [ ] Improve focus, selection, and scrolling behavior
- [ ] Add basic error handling and fallback states for unsupported content
- [ ] Polish toolbar or contextual controls if needed

  
---


