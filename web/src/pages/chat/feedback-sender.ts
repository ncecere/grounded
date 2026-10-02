/*
 * Where an answer's thumbs go: the signed-in chat rates through POST /v1/messages/{id}/feedback (the default); the public
 * page and the widget through the anonymous session's endpoint (POST /v1/public/agents/{agentId}/messages/{id}/feedback),
 * which only accepts answers in the session's own conversations.
 */
import { createContext, useContext } from "react";
import { api, unwrap, type Schemas } from "../../api/client";

export type FeedbackBody = Schemas["Feedback"];
export type FeedbackSender = (messageId: string, body: FeedbackBody) => Promise<Schemas["FeedbackResult"]>;

const signedIn: FeedbackSender = async (messageId, body) =>
  unwrap(await api.POST("/v1/messages/{messageId}/feedback", { params: { path: { messageId } }, body }));

/** The anonymous session's feedback for a public agent. */
export const publicFeedback =
  (agentId: string): FeedbackSender =>
  async (messageId, body) =>
    unwrap(await api.POST("/v1/public/agents/{agentId}/messages/{messageId}/feedback", { params: { path: { agentId, messageId } }, body }));

export const FeedbackSenderContext = createContext<FeedbackSender>(signedIn);

export const useFeedbackSender = () => useContext(FeedbackSenderContext);
