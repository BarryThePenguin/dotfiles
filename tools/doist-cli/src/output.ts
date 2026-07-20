export function out(data: unknown): void {
	process.stdout.write(JSON.stringify(data) + "\n");
}
