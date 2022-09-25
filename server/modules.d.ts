declare module 'is-string-and-not-blank' {
	// eslint-disable-next-line @typescript-eslint/naming-convention
	type isSANB = (str: unknown) => boolean;
	// eslint-disable-next-line @typescript-eslint/naming-convention
	const isSANB: isSANB;
	export default isSANB;
}

declare module 'eslint-rule-docs' {
	interface RuleDocResult {
		url?: string;
	}
	// eslint-disable-next-line @typescript-eslint/naming-convention
	type getRuleUrl = (ruleId?: string) => RuleDocResult;

	const getRuleUrl: getRuleUrl;

	export default getRuleUrl;
}
