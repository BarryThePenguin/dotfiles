/**
 * Generic issue model.
 *
 * The Issue shape is the cross-tracker surface the `issue_*` tools expose.
 * Maps and Wayfinder decision tickets are also Issues — discriminated only
 * by `wayfinder:` labels and (locally) by the file layout.
 */

export type IssueStatus = "open" | "closed";

export type IssueComment = {
	content: string;
	postedAt?: string;
};

export type Issue = {
	id: string;
	url: string;
	title: string;
	body: string;
	labels: string[];
	status: IssueStatus;
	comments: IssueComment[];
	createdAt?: string;
	updatedAt?: string;
};

export type CreateIssueInput = {
	title: string;
	body?: string;
	labels?: string[];
};

export type UpdateIssueLabelsInput = {
	add?: string[];
	remove?: string[];
};

export interface IssueTracker {
	createIssue(input: CreateIssueInput): Promise<Issue>;
	readIssue(id: string): Promise<Issue>;
	updateIssueLabels(
		id: string,
		input: UpdateIssueLabelsInput,
	): Promise<Issue>;
	commentOnIssue(
		id: string,
		body: string,
	): Promise<{ comment: IssueComment }>;
	closeIssue(
		id: string,
		options?: { comment?: string },
	): Promise<{ status: IssueStatus }>;
	listIssues(filter: ListIssuesFilter): Promise<Issue[]>;
}

export type ListIssuesFilter = {
	state?: IssueStatus | "any";
	labels?: string[];
	unlabeled?: boolean;
};
