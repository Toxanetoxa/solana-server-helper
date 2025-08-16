import { z } from "zod";

const ClientCommandSchema = z.object({
	type: z.literal("set_mode"),
	risk: z.enum(["eco", "balanced", "aggr"]),
});

type ClientCommand = z.infer<typeof ClientCommandSchema>;

export { ClientCommandSchema };
export type { ClientCommand };
