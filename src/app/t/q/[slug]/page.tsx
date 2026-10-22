import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { ServiceError } from "../../../../lib/api/errors.js";

import { QuestionWorkspace } from "../../../../components/tournament-question/question-workspace.js";
import { getRuntimeDatabase } from "../../../../lib/db/runtime.js";
import {
  getQuestion,
  listLatestForecasts,
  type PublicForecast,
  type QuestionDetail,
} from "../../../../lib/services/tournament/get-question.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface QuestionPageProps {
  readonly params: Promise<{ readonly slug: string }>;
}

const loadQuestion = cache(async function loadQuestion(
  slug: string,
): Promise<{ question: QuestionDetail | null; forecasts: PublicForecast[] | null }> {
  try {
    const database = getRuntimeDatabase();
    const [question, forecasts] = await Promise.all([
      getQuestion(database, slug),
      listLatestForecasts(database, slug),
    ]);
    return { question, forecasts: forecasts.forecasts };
  } catch (error) {
    if (error instanceof ServiceError && error.code === "QUESTION_NOT_FOUND") notFound();
    return { question: null, forecasts: null };
  }
});

export async function generateMetadata({ params }: QuestionPageProps): Promise<Metadata> {
  const { slug } = await params;
  const { question } = await loadQuestion(slug);
  return { title: question?.title ?? "Question" };
}

export default async function QuestionPage({ params }: QuestionPageProps) {
  const { slug } = await params;
  const initial = await loadQuestion(slug);
  return (
    <QuestionWorkspace
      slug={slug}
      initialQuestion={initial.question}
      initialForecasts={initial.forecasts}
    />
  );
}
