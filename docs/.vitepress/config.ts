import { defineConfig } from "vitepress";

export default defineConfig({
	title: "open-mem",
	description: "Persistent memory for AI coding assistants",

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
					{ text: "Platform Adapters", link: "/platforms" },
				],
			},
			{
				text: "More",
				items: [
					{ text: "Privacy & Security", link: "/privacy" },
					{ text: "Troubleshooting", link: "/troubleshooting" },
					{ text: "Changelog", link: "/changelog" },
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
			copyright: "Copyright © 2026 open-mem contributors",
		},

		search: {
			provider: "local",
		},
	},
});
