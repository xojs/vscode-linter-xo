declare module 'eslint-rule-docs' {
	interface RuleDocResult {
		url?: string;
	}
	// eslint-disable-next-line @typescript-eslint/naming-convention
	type getRuleUrl = (ruleId?: string) => RuleDocResult;

	const getRuleUrl: getRuleUrl;

	export default getRuleUrl;
}
