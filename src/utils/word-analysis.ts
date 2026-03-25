export interface WordSelectionAnalysis {
	surface: string;
	resolvedBaseExpression: string;
	lookupCandidates: string[];
	aliases: string[];
}

const SIMPLE_WORD_RE = /^[a-z][a-z'-]*$/i;

const IRREGULAR_FAMILIES: Array<[string, string[]]> = [
	["be", ["am", "is", "are", "was", "were", "been", "being"]],
	["begin", ["began", "begun"]],
	["break", ["broke", "broken"]],
	["bring", ["brought"]],
	["build", ["built"]],
	["buy", ["bought"]],
	["catch", ["caught"]],
	["choose", ["chose", "chosen"]],
	["come", ["came"]],
	["do", ["did", "done"]],
	["draw", ["drew", "drawn"]],
	["drink", ["drank", "drunk"]],
	["drive", ["drove", "driven"]],
	["eat", ["ate", "eaten"]],
	["fall", ["fell", "fallen"]],
	["feel", ["felt"]],
	["find", ["found"]],
	["fly", ["flew", "flown"]],
	["forget", ["forgot", "forgotten"]],
	["get", ["got", "gotten"]],
	["give", ["gave", "given"]],
	["go", ["went", "gone"]],
	["grow", ["grew", "grown"]],
	["have", ["had"]],
	["hear", ["heard"]],
	["hold", ["held"]],
	["keep", ["kept"]],
	["know", ["knew", "known"]],
	["leave", ["left"]],
	["lose", ["lost"]],
	["make", ["made"]],
	["meet", ["met"]],
	["pay", ["paid"]],
	["read", ["read"]],
	["ride", ["rode", "ridden"]],
	["ring", ["rang", "rung"]],
	["run", ["ran"]],
	["say", ["said"]],
	["see", ["saw", "seen"]],
	["sell", ["sold"]],
	["send", ["sent"]],
	["shake", ["shook", "shaken"]],
	["sing", ["sang", "sung"]],
	["sit", ["sat"]],
	["speak", ["spoke", "spoken"]],
	["stand", ["stood"]],
	["swim", ["swam", "swum"]],
	["take", ["took", "taken"]],
	["teach", ["taught"]],
	["tell", ["told"]],
	["think", ["thought"]],
	["throw", ["threw", "thrown"]],
	["understand", ["understood"]],
	["wear", ["wore", "worn"]],
	["win", ["won"]],
	["write", ["wrote", "written"]],
	["man", ["men"]],
	["woman", ["women"]],
	["child", ["children"]],
	["mouse", ["mice"]],
	["goose", ["geese"]],
	["tooth", ["teeth"]],
	["foot", ["feet"]],
	["person", ["people"]],
	["ox", ["oxen"]],
	["good", ["better", "best"]],
	["well", ["better", "best"]],
	["bad", ["worse", "worst"]],
	["ill", ["worse", "worst"]],
];

const IRREGULAR_BASE_MAP = buildIrregularBaseMap();

function buildIrregularBaseMap(): Record<string, string[]> {
	const map: Record<string, string[]> = {};
	for (const [base, forms] of IRREGULAR_FAMILIES) {
		for (const form of forms) {
			const normalizedForm = normalizeWordForm(form);
			if (!normalizedForm) continue;
			if (!map[normalizedForm]) {
				map[normalizedForm] = [];
			}
			if (!map[normalizedForm].includes(base)) {
				map[normalizedForm].push(base);
			}
		}
	}
	return map;
}

function normalizeWordForm(value?: string | null): string {
	return (value || "").trim().toLowerCase();
}

function uniqueWords(words: Array<string | null | undefined>): string[] {
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

export function getIrregularBaseCandidates(selection: string): string[] {
	const normalizedSelection = normalizeWordForm(selection);
	if (!normalizedSelection) return [];
	return [...(IRREGULAR_BASE_MAP[normalizedSelection] || [])];
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

function getHighConfidenceCandidate(candidates: string[]): string {
	return candidates.length === 1 ? candidates[0] : "";
}

export function analyzeWordSelection(
	selection: string,
	title?: string | null,
	pattern?: string | null
): WordSelectionAnalysis {
	const surface = normalizeWordForm(selection);
	if (!surface || surface.includes(" ") || !SIMPLE_WORD_RE.test(surface)) {
		return {
			surface,
			resolvedBaseExpression: surface,
			lookupCandidates: [],
			aliases: [],
		};
	}

	const titleCandidate = normalizeWordForm(title);
	const authoritativeTitle =
		titleCandidate && titleCandidate !== surface ? titleCandidate : "";
	const irregularCandidates = getIrregularBaseCandidates(surface);
	const heuristicCandidates = getHeuristicBaseCandidates(surface);
	const irregularBase = getHighConfidenceCandidate(irregularCandidates);
	const heuristicBase = getHighConfidenceCandidate(heuristicCandidates);
	const resolvedBaseExpression =
		authoritativeTitle || irregularBase || heuristicBase || surface;

	const lookupCandidates = uniqueWords([
		authoritativeTitle,
		!authoritativeTitle ? irregularBase : "",
		!authoritativeTitle && !irregularBase ? heuristicBase : "",
	]).filter((candidate) => candidate !== surface);

	const aliases = uniqueWords([surface, ...extractWordForms(pattern || "")]).filter(
		(word) => word !== resolvedBaseExpression
	);

	return {
		surface,
		resolvedBaseExpression,
		lookupCandidates,
		aliases,
	};
}
