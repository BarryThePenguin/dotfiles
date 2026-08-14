import { driverFactory } from "sqlite-runtime";
import { Database } from "../db.ts";

export function openDb() {
	return new Database({ driver: driverFactory(":memory:") });
}
