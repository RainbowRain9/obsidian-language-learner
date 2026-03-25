export interface WordSelectionAnalysis {
	baseExpression: string;
	aliases: string[];
	heuristicCandidates: string[];
}

const SIMPLE_WORD_RE = /^[a-z][a-z'-]*$/i;

function normalizeWordForm(value?: string | null): string {
	return (value || "").trim().toLowerCase();
}

function uniqueWords(words: string[]): string[] {
	return [...new Set(words.map((word) => normalizeWordForm(word)).filter(Boolean))];
}

export function extractWordForms(pattern: string): string[] {
	if (!pattern) return [];
	return pattern
		.replace(/[()]/g, "")
		.split(/\s+/)
		.map((part) => part.replace(/\.$/, ""))
		.filter((part) => part && /^[a-zA-Z'-]+$/.test(part))
		.map((part) => part.toLowerCase());
}

function addCandidate(target: Set<string>, candidate: string) {
	if (!candidate) return;
	const normalized = normalizeWordForm(candidate);
	if (!normalized || normalized.length < 2 || !SIMPLE_WORD_RE.test(normalized)) return;
	target.add(normalized);
}

export function getHeuristicBaseCandidates(selection: string): string[] {
	const word = normalizeWordForm(selection);
	if (!word || !SIMPLE_WORD_RE.test(word) || word.includes(" ")) {
		return [];
	}

	const candidates = new Set<string>();

	if (word.endsWith("ies") && word.length > 4) {
		addCandidate(candidates, word.slice(0, -3) + "y");
	}

	if (word.endsWith("ied") && word.length > 4) {
		addCandidate(candidates, word.slice(0, -3) + "y");
	}

	if (word.endsWith("ing") && word.length > 5) {
		const stem = word.slice(0, -3);
		addCandidate(candidates, stem);
		if (/([bcdfghjklmnpqrstvwxyz])\1$/i.test(stem)) {
			addCandidate(candidates, stem.slice(0, -1));
		}
		if (!stem.endsWith("e")) {
			addCandidate(candidates, stem + "e");
		}
	}

	if (word.endsWith("ed") && word.length > 4) {
		const stem = word.slice(0, -2);
		addCandidate(candidates, stem);
		if (/([bcdfghjklmnpqrstvwxyz])\1$/i.test(stem)) {
			addCandidate(candidates, stem.slice(0, -1));
		}
		if (!stem.endsWith("e")) {
			addCandidate(candidates, stem + "e");
		}
	}

	if (word.endsWith("es") && word.length > 4) {
		const stem = word.slice(0, -2);
		addCandidate(candidates, stem);
		if (!stem.endsWith("e")) {
			addCandidate(candidates, stem + "e");
		}
	}

	if (
		word.endsWith("s") &&
		word.length > 3 &&
		!/(ss|us|is|ics|ness)$/i.test(word)
	) {
		addCandidate(candidates, word.slice(0, -1));
	}

	candidates.delete(word);
	return [...candidates];
}

export function analyzeWordSelection(
	selection: string,
	title?: string | null,
	pattern?: string | null
): WordSelectionAnalysis {
	const normalizedSelection = normalizeWordForm(selection);
	if (!normalizedSelection || normalizedSelection.includes(" ")) {
		return {
			baseExpression: normalizedSelection,
			aliases: [],
			heuristicCandidates: [],
		};
	}

	const normalizedTitle = normalizeWordForm(title);
	const patternForms = extractWordForms(pattern || "");
	const baseExpression = normalizedTitle || normalizedSelection;
	const aliases = uniqueWords([normalizedSelection, ...patternForms]).filter(
		(word) => word !== baseExpression
	);

	return {
		baseExpression,
		aliases,
		heuristicCandidates: normalizedTitle && normalizedTitle !== normalizedSelection
			? []
			: getHeuristicBaseCandidates(normalizedSelection),
	};
}
