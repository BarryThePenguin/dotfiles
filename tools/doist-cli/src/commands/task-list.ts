import { defineCommand } from "citty";
import {
	countSyncData,
	ListTaskCliFields,
	type OperationalContainer,
	type TodoistOperations,
} from "doist-core";
import { out } from "../output.ts";

export function buildCommand(
	container: OperationalContainer,
	operations: TodoistOperations,
) {
	return defineCommand({
		meta: { description: "List incomplete tasks" },
		args: ListTaskCliFields.args,
		async run({ args }) {
			const { queries } = container;
			const {
				project,
				sync: shouldSync,
				details,
				...fields
			} = ListTaskCliFields.read(args);
			const projectId = project
				? operations.resolveProject(project)
				: undefined;
			// Defaults to full task data (unlike the MCP tool's id/content-only
			// default) to preserve this command's existing output shape.
			const showDetails = details ?? true;
			const tasks = (
				project && !projectId
					? []
					: queries.selectTasks({
							kind: "browse",
							...fields,
							...(projectId ? { projectId } : {}),
						})
			).map((task) =>
				showDetails ? task : { id: task.id, content: task.content },
			);
			if (shouldSync) {
				const syncResult = await container.sync(
					container.listProjectIds(),
					false,
				);
				out({
					synced: countSyncData(syncResult),
					tasks,
				});
			} else {
				out(tasks);
			}
		},
	});
}
