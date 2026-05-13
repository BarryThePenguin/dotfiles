export function out(data: unknown): void {
	process.stdout.write(JSON.stringify(data, null, 2) + "\n");
}
