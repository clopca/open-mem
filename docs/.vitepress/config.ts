import { defineConfig } from "vitepress";

export default defineConfig({
	title: "open-mem",
	description: "Persistent memory for AI coding assistants",
	lastUpdated: true,

	head: [
		["meta", { property: "og:title", content: "open-mem" }],
		[
			"meta",
			{
				property: "og:description",
				content:
					"Persistent memory for AI coding assistants. Captures, compresses, and recalls context across sessions.",
			},
		],
		["meta", { property: "og:type", content: "website" }],
		["meta", { name: "twitter:card", content: "summary" }],
		["meta", { name: "twitter:title", content: "open-mem" }],
		[
			"meta",
			{
				name: "twitter:description",
				content:
					"Persistent memory for AI coding assistants. Captures, compresses, and recalls context across sessions.",
			},
		],
	],

	themeConfig: {
		nav: [
			{ text: "Guide", link: "/getting-started" },
			{ text: "Tools", link: "/tools" },
			{ text: "API", link: "/api" },
			{ text: "Changelog", link: "/changelog" },
		],

		sidebar: [
			{
				text: "Introduction",
				items: [
					{ text: "What is open-mem?", link: "/" },
					{ text: "Getting Started", link: "/getting-started" },
				],
			},
			{
				text: "Core Concepts",
				items: [
					{ text: "Architecture", link: "/architecture" },
					{ text: "Search", link: "/search" },
					{ text: "Configuration", link: "/configuration" },
				],
			},
			{
				text: "Reference",
				items: [
					{ text: "Memory Tools", link: "/tools" },
					{ text: "HTTP API", link: "/api" },
					{ text: "Dashboard", link: "/dashboard" },
					{ text: "Platform Adapters", link: "/platforms" },
					{ text: "MCP Compatibility", link: "/mcp-compatibility-matrix" },
				],
			},
			{
				text: "More",
				items: [
					{ text: "Privacy & Security", link: "/privacy" },
					{ text: "Troubleshooting", link: "/troubleshooting" },
					{ text: "Changelog", link: "/changelog" },
					{
						text: "Contributing",
						link: "https://github.com/clopca/open-mem/blob/main/CONTRIBUTING.md",
					},
				],
			},
		],

		socialLinks: [{ icon: "github", link: "https://github.com/clopca/open-mem" }],

		editLink: {
			pattern: "https://github.com/clopca/open-mem/edit/main/docs/:path",
			text: "Edit this page on GitHub",
		},

		footer: {
			message: "Released under the MIT License.",
			copyright: "Copyright © 2025-present open-mem contributors",
		},

		search: {
			provider: "local",
		},
	},
});
