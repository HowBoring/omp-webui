/** Read-only candidate. The native submission target identifies the currently protected Session. */
export const branchInspectDefs = {
	BranchInspectCut: { parentId: "string | null", targetRevision: "string", contextRevision: "string" },
	BranchInspectPreview: {
		version: "'branch-inspect-v1'", source: "SubmissionTarget", entryId: "string",
		parentId: "string | null", targetRevision: "string", contextRevision: "string",
	},
};

export const branchInspectCommands = [
	{
		name: "branch_inspect",
		doc: "Read or revalidate the selected native user-message cut without creating a Session.",
		params: { source: "SubmissionTarget", entryId: "string", "expected?": "BranchInspectCut" },
		result: "BranchInspectPreview",
	},
] as const;
