import { redirect } from "next/navigation";

/** The tournament is the front door; the markets board lives at /m. */
export default function HomePage(): never {
  redirect("/t");
}
