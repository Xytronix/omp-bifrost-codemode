import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent"

type Span = { t: string, s?: string }
type Row = string | Span[]
type Args = Record<string, unknown>
type Call = { server: string, tool: string, args: Args }
type Block = {
	type: string
	toolName?: string
	args?: unknown
	result?: unknown
	isError?: boolean
	isPartial?: boolean
}

const TOOLS: Record<string, true> = { executetoolcode: true, listtoolfiles: true, readtoolfile: true, gettooldocs: true }
const BUILTINS: Record<string, true> = { json: true, math: true, time: true, re: true, str: true, int: true, float: true, dict: true, list: true, struct: true, base64: true }
const WIDTH = 140
const SHOWN = 5

function routeOf(name: string): { server: string, tool: string } | undefined {
	const m = /^(?:xd:\/\/)?mcp__(.+?)__([A-Za-z]+)$/.exec(name)
	const tool = m?.[2].toLowerCase()
	return m && tool && TOOLS[tool] ? { server: m[1], tool } : undefined
}

function callOf(block: Block): Call | undefined {
	const args = (block.args && typeof block.args === "object" ? block.args : {}) as Args
	if (typeof args.path === "string" && args.path.startsWith("xd://")) {
		const route = routeOf(args.path)
		if (!route) return undefined
		let parsed: Args = {}
		if (typeof args.content === "string") {
			try {
				const value = JSON.parse(args.content)
				if (value && typeof value === "object") parsed = value as Args
			} catch {}
		}
		return { ...route, args: parsed }
	}
	const route = routeOf(block.toolName ?? "")
	return route ? { ...route, args } : undefined
}

function head(call: Call, verb: string): Span {
	return { t: `${call.server} ${verb} `, s: "accent" }
}

function textOf(result: unknown): string {
	const content = (result as { content?: unknown } | undefined)?.content
	if (!Array.isArray(content)) return ""
	return content
		.filter(c => c && c.type === "text" && typeof c.text === "string")
		.map(c => c.text as string)
		.join("\n")
}

function clip(text: string, width = WIDTH): string {
	const flat = text.replace(/\s+/g, " ").trim()
	return flat.length > width ? `${flat.slice(0, width - 1)}…` : flat
}

function lines(text: string): string[] {
	return text.split("\n").filter(l => !/^```/.test(l))
}

function more(hidden: number, noun: string): Row[] {
	return hidden > 0 ? [[{ t: `+${hidden} more ${noun}`, s: "dim" }]] : []
}

function errorRow(text: string): Row[] {
	const body = text.split("\n\nHints:")[0]
	const all = lines(body).map(l => l.trim()).filter(Boolean)
	const pick =
		all.find(l => /code\.star:\d+:\d+: /.test(l)) ??
		all.find(l => /^Error:/.test(l) && !/Execution runtime error/.test(l)) ??
		all.find(l => !/^(Error: )?(Execution runtime error|Traceback)/.test(l)) ??
		all[0] ??
		"failed"
	return [[{ t: clip(pick), s: "error" }]]
}

function splitParams(params: string): string[] {
	const out: string[] = []
	let depth = 0
	let quote = ""
	let start = 0
	for (let i = 0; i < params.length; i++) {
		const c = params[i]
		if (quote) {
			if (c === quote) quote = ""
		} else if (c === '"' || c === "'") quote = c
		else if ("[({".includes(c)) depth++
		else if ("])}".includes(c)) depth--
		else if (c === "," && depth === 0) {
			out.push(params.slice(start, i).trim())
			start = i + 1
		}
	}
	const last = params.slice(start).trim()
	if (last) out.push(last)
	return out
}

function signature(line: string, prefix = ""): Span[] | undefined {
	const m = /^def ([\w]+)\((.*)\)\s*->\s*([^:]+?)\s*:/.exec(line)
	if (!m) return undefined
	const params = splitParams(m[2]).map(p => {
		const name = /^(\w+)/.exec(p)?.[1] ?? p
		return p.includes("=") ? `${name}?` : name
	})
	return [
		{ t: prefix + m[1], s: "mdCode" },
		{ t: `(${params.join(", ")})`, s: "muted" },
		{ t: ` → ${m[3]}`, s: "dim" },
	]
}

function serverCalls(code: string): string[] {
	const local = new Set<string>()
	for (const m of code.matchAll(/^\s*([A-Za-z_]\w*(?:\s*,\s*[A-Za-z_]\w*)*)\s*=(?!=)/gm)) {
		for (const name of m[1].split(",")) local.add(name.trim())
	}
	for (const m of code.matchAll(/\bfor\s+([A-Za-z_]\w*(?:\s*,\s*[A-Za-z_]\w*)*)\s+in\b/g)) {
		for (const name of m[1].split(",")) local.add(name.trim())
	}
	for (const m of code.matchAll(/\bdef\s+\w+\s*\(([^)]*)\)/g)) {
		for (const p of splitParams(m[1])) local.add(/^(\w+)/.exec(p)?.[1] ?? p)
	}
	const calls: string[] = []
	for (const m of code.matchAll(/(?<![.\w])([A-Za-z_]\w*)\.([A-Za-z_]\w*)\s*\(/g)) {
		if (local.has(m[1]) || BUILTINS[m[1]]) continue
		const id = `${m[1]}.${m[2]}`
		if (!calls.includes(id)) calls.push(id)
	}
	return calls
}

function execute(call: Call, text: string, block: Block): { label: Span[], rows: Row[] } {
	const code = typeof call.args.code === "string" ? call.args.code : ""
	const calls = serverCalls(code)
	const what = calls.length > 0 ? calls.join(", ") : clip(code.split("\n").find(l => l.trim()) ?? "", 60)
	const label: Span[] = [head(call, "run"), { t: clip(what, 90), s: "mdCode" }]
	if (block.isPartial || !text) return { label, rows: [] }
	if (block.isError) return { label, rows: errorRow(text) }
	const rows: Row[] = []
	const prints = /^Print output:\n([\s\S]*?)\n\nExecution completed/.exec(text)?.[1]
	if (prints) {
		const out = prints.split("\n")
		for (const l of out.slice(0, SHOWN)) rows.push([{ t: clip(l), s: "muted" }])
		rows.push(...more(out.length - SHOWN, "print lines"))
	}
	const value = /Execution completed successfully\.\nReturn value: ([\s\S]*)$/.exec(text)?.[1]
	if (value) rows.push([{ t: "→ ", s: "dim" }, { t: clip(value), s: "success" }])
	if (rows.length === 0) rows.push([{ t: clip(text), s: "muted" }])
	return { label, rows }
}

function list(call: Call, text: string): { label: Span[], rows: Row[] } {
	const query = typeof call.args.query === "string" ? call.args.query : ""
	const server = typeof call.args.server === "string" ? call.args.server : ""
	const label: Span[] = [head(call, "list"), { t: query ? `“${clip(query, 80)}”` : server || "all servers", s: "mdCode" }]
	const ranked = [...text.matchAll(/relevance=([\d.]+)\W+tool=([\w.-]+)/g)]
	if (ranked.length > 0) {
		const rows: Row[] = ranked.slice(0, SHOWN).map(m => [
			{ t: m[2], s: "mdCode" },
			{ t: `  ${Number(m[1]).toFixed(2)}`, s: "dim" },
		])
		return { label, rows: [...rows, ...more(ranked.length - SHOWN, "tools")] }
	}
	const names = [...new Set([...text.matchAll(/([\w-]+)\.pyi/g)].map(m => m[1]))]
	if (names.length === 0) return { label, rows: text ? [[{ t: clip(text), s: "muted" }]] : [] }
	return {
		label,
		rows: [[{ t: `${names.length} servers  `, s: "dim" }, { t: clip(names.join(", ")), s: "muted" }]],
	}
}

function read(call: Call, text: string): { label: Span[], rows: Row[] } {
	const files = Array.isArray(call.args.fileNames)
		? (call.args.fileNames as unknown[]).filter((f): f is string => typeof f === "string")
		: typeof call.args.fileName === "string"
			? [call.args.fileName]
			: []
	const names = files.map(f => f.replace(/^servers\//, "").replace(/\.pyi$/, ""))
	const label: Span[] = [head(call, "read"), { t: clip(names.join(", "), 90), s: "mdCode" }]
	const multi = names.length > 1
	const sigs: Span[][] = []
	let server = ""
	for (const l of lines(text)) {
		const header = /^# ([\w.-]+) server tools\s*$/.exec(l)
		if (header) server = header[1]
		const sig = signature(l, multi && server ? `${server}.` : "")
		if (sig) sigs.push(sig)
	}
	return { label, rows: [...sigs.slice(0, SHOWN), ...more(sigs.length - SHOWN, "tools")] }
}

function docs(call: Call, text: string): { label: Span[], rows: Row[] } {
	const id = [call.args.server, call.args.tool].filter(v => typeof v === "string").join(".")
	const label: Span[] = [head(call, "docs"), { t: id, s: "mdCode" }]
	const all = lines(text)
	const rows: Row[] = []
	const defAt = all.findIndex(l => /^def /.test(l))
	if (defAt >= 0) {
		const sig = signature(all[defAt])
		if (sig) rows.push(sig)
		const body: string[] = []
		for (const l of all.slice(defAt + 1)) {
			const t = l.trim()
			if (t === '"""' || t === "") {
				if (body.length > 0) break
				continue
			}
			body.push(t.replace(/^"""/, ""))
		}
		if (body.length > 0) rows.push([{ t: clip(body.join(" ")), s: "muted" }])
	}
	return { label, rows }
}

export function present(block: Block): { compact: { label: Span[], rows: Row[] } } | undefined {
	if (block.type !== "toolCall") return undefined
	const call = callOf(block)
	if (!call) return undefined
	const text = textOf(block.result)
	if (call.tool === "executetoolcode") return { compact: execute(call, text, block) }
	const view = call.tool === "listtoolfiles" ? list(call, text) : call.tool === "readtoolfile" ? read(call, text) : docs(call, text)
	if (block.isError && text) view.rows = errorRow(text)
	return { compact: view }
}

export default function bifrostCodemode(pi: ExtensionAPI) {
	pi.registerTranscriptPresenter(block => present(block as Block))
}
