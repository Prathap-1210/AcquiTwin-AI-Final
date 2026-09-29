import {
  useState,
  type FormEvent,
} from "react";

import type {
  HistoryEntry,
  Project,
} from "../services/projectsApi";

import {
  askCopilot,
  type CopilotConversationMessage,
} from "../services/copilotApi";


// ============================================================
// MESSAGE TYPE
// ============================================================

type Message = {
  id: number;

  from:
    | "user"
    | "assistant";

  text: string;

  tools?: string[];
};


// ============================================================
// COMPONENT PROPS
// ============================================================

interface Props {
  open: boolean;

  onOpen: () => void;

  onClose: () => void;

  /*
    Keep the existing App.tsx prop contract.

    These props are preserved so we do not need
    to rewrite App.tsx just to introduce the
    new Copilot.
  */

  projects: Project[];

  totalProjects: number;

  selectedProject: Project | null;

  history: HistoryEntry[];

  projectError: string;

  historyError: string;
}


// ============================================================
// CONVERT UI MESSAGES INTO COPILOT CONVERSATION HISTORY
// ============================================================

function conversationFromMessages(
  messages: Message[]
): CopilotConversationMessage[] {

  return messages
    .filter(
      (message) =>
        message.id !== 0
    )
    .slice(-8)
    .map(
      (message) => ({
        role:
          message.from === "user"
            ? "user"
            : "assistant",

        content:
          message.text,
      })
    );
}


// ============================================================
// MAIN COMPONENT
// ============================================================

export default function AssistantPanel({
  open,
  onOpen,
  onClose,
  selectedProject,
}: Props) {

  // ==========================================================
  // STATE
  // ==========================================================

  const [
    draft,
    setDraft,
  ] = useState("");

  const [
    sending,
    setSending,
  ] = useState(false);

  const [
    messages,
    setMessages,
  ] = useState<Message[]>([
    {
      id: 0,

      from: "assistant",

      text:
        "Hello. I’m AcquiTwin Copilot. " +
        "Ask me about the selected project, " +
        "predictions, risk factors, stages, " +
        "documents, previous predictions, " +
        "portfolio records, or a What-If scenario.",
    },
  ]);


  // ==========================================================
  // SEND QUESTION
  // ==========================================================

  async function send(
    text: string
  ): Promise<void> {

    const cleaned =
      text.trim();

    if (
      !cleaned ||
      sending
    ) {
      return;
    }


    // --------------------------------------------------------
    // USER MESSAGE
    // --------------------------------------------------------

    const userMessage: Message = {
      id: Date.now(),

      from: "user",

      text: cleaned,
    };


    // --------------------------------------------------------
    // PREVIOUS CONVERSATION
    // --------------------------------------------------------

    const priorConversation =
      conversationFromMessages(
        messages
      );


    // --------------------------------------------------------
    // ADD USER MESSAGE TO UI
    // --------------------------------------------------------

    setMessages(
      (previous) => [
        ...previous.slice(-20),

        userMessage,
      ]
    );


    setDraft("");

    setSending(true);


    // --------------------------------------------------------
    // CALL BACKEND COPILOT
    // --------------------------------------------------------

    try {

      const response =
        await askCopilot({
          question:
            cleaned,

          project_id:
            selectedProject?.id
            ?? null,

          conversation:
            priorConversation,
        });


      // ------------------------------------------------------
      // ADD AI ANSWER
      // ------------------------------------------------------

      setMessages(
        (previous) => [
          ...previous.slice(-20),

          {
            id:
              Date.now() + 1,

            from:
              "assistant",

            text:
              response.answer,

            tools:
              response.tools_used,
          },
        ]
      );

    } catch (error) {

      // ------------------------------------------------------
      // DISPLAY ERROR SAFELY
      // ------------------------------------------------------

      const message =
        error instanceof Error
          ? error.message
          : "The Copilot request failed.";


      setMessages(
        (previous) => [
          ...previous.slice(-20),

          {
            id:
              Date.now() + 1,

            from:
              "assistant",

            text:
              (
                "I could not complete " +
                "that request. " +
                message
              ),
          },
        ]
      );

    } finally {

      setSending(false);

    }
  }


  // ==========================================================
  // FORM SUBMIT
  // ==========================================================

  function submit(
    event:
      FormEvent<HTMLFormElement>
  ): void {

    event.preventDefault();

    void send(draft);
  }


  // ==========================================================
  // CLOSED STATE
  // ==========================================================

  if (!open) {

    return (
      <button
        type="button"

        className=
          "assistant-launcher"

        onClick=
          {onOpen}

        aria-label=
          "Open AcquiTwin Copilot"
      >
        <span
          aria-hidden="true"
        >
          ✦
        </span>

        {" "}

        Ask AI
      </button>
    );
  }


  // ==========================================================
  // SUGGESTED QUESTIONS
  // ==========================================================

  const suggestions =
    selectedProject
      ? [
          "Why is this project at risk?",

          "What are the main risk factors?",

          "Summarize the latest prediction",
        ]

      : [
          "Summarize the project portfolio",

          "Which projects have saved high risk?",

          "What can AcquiTwin Copilot do?",
        ];


  // ==========================================================
  // OPEN PANEL
  // ==========================================================

  return (
    <>

      {/* ======================================================
          MOBILE BACKDROP
      ====================================================== */}

      <button
        className=
          "assistant-mobile-backdrop"

        type="button"

        onClick=
          {onClose}

        aria-label=
          "Close AcquiTwin Copilot"
      />


      {/* ======================================================
          COPILOT SIDEBAR
      ====================================================== */}

      <aside
        className=
          "assistant-rail"

        aria-label=
          "AcquiTwin Copilot sidebar"
      >

        <section
          className=
            "assistant-panel"

          aria-label=
            "AcquiTwin Copilot"
        >

          {/* ==================================================
              HEADER
          ================================================== */}

          <header
            className=
              "assistant-heading"
          >

            <span
              className=
                "assistant-avatar"

              aria-hidden=
                "true"
            >
              ✦
            </span>


            <div>

              <strong>
                AcquiTwin Copilot
              </strong>

              <small>
                Ask. Analyse. Simulate. Act.
              </small>

            </div>


            <button
              type="button"

              className=
                "assistant-close"

              aria-label=
                "Close AI panel"

              onClick=
                {onClose}
            >
              ×
            </button>

          </header>


          {/* ==================================================
              ACTIVE PROJECT
          ================================================== */}

          <p
            className=
              "assistant-context"
          >
            Active project:{" "}

            {
              selectedProject
                ? (
                    `${selectedProject.project_id} — ` +
                    `${selectedProject.project_name}`
                  )

                : "None selected"
            }
          </p>


          {/* ==================================================
              CHAT MESSAGES
          ================================================== */}

          <div
            className=
              "assistant-messages"

            role=
              "log"

            aria-live=
              "polite"

            aria-label=
              "Copilot conversation"
          >

            {
              messages.map(
                (message) => (

                  <div
                    key=
                      {message.id}
                  >

                    <p
                      className={
                        `assistant-message ${
                          message.from === "user"
                            ? "assistant-user"
                            : "assistant-answer"
                        }`
                      }

                      style={{
                        whiteSpace:
                          "pre-wrap",
                      }}
                    >
                      {
                        message.text
                      }
                    </p>


                    {/* =========================================
                        SHOW WHICH ACQUITWIN TOOLS WERE USED
                    ========================================= */}

                    {
                      message.from ===
                        "assistant" &&

                      message.tools &&

                      message.tools.length >
                        0 && (

                        <small
                          style={{
                            display:
                              "block",

                            margin:
                              "-4px 12px 10px 12px",

                            opacity:
                              0.65,

                            fontSize:
                              "10px",
                          }}
                        >
                          Evidence tools:{" "}

                          {
                            message.tools.join(
                              ", "
                            )
                          }

                        </small>
                      )
                    }

                  </div>
                )
              )
            }


            {/* =================================================
                THINKING / ANALYSING INDICATOR
            ================================================= */}

            {
              sending && (

                <p
                  className=
                    "assistant-message assistant-answer"

                  aria-live=
                    "polite"
                >
                  Analysing AcquiTwin evidence…
                </p>
              )
            }

          </div>


          {/* ==================================================
              SUGGESTED QUESTIONS
          ================================================== */}

          <div
            className=
              "assistant-suggestions"

            aria-label=
              "Suggested questions"
          >

            {
              suggestions.map(
                (question) => (

                  <button
                    key=
                      {question}

                    type=
                      "button"

                    disabled=
                      {sending}

                    onClick={() => {
                      void send(
                        question
                      );
                    }}
                  >
                    {question}
                  </button>
                )
              )
            }

          </div>


          {/* ==================================================
              QUESTION INPUT
          ================================================== */}

          <form
            className=
              "assistant-compose"

            onSubmit=
              {submit}
          >

            <label
              htmlFor=
                "assistant-input"

              className=
                "assistant-visually-hidden"
            >
              Ask AcquiTwin Copilot
            </label>


            <input
              id=
                "assistant-input"

              value=
                {draft}

              onChange={
                (event) =>
                  setDraft(
                    event.target.value
                  )
              }

              placeholder=
                "Ask anything about AcquiTwin…"

              maxLength=
                {2000}

              disabled=
                {sending}
            />


            <button
              type=
                "submit"

              disabled={
                sending ||
                !draft.trim()
              }

              aria-label=
                "Send question"
            >
              ➤
            </button>

          </form>


          {/* ==================================================
              DISCLAIMER
          ================================================== */}

          <small
            className=
              "assistant-footnote"
          >
            Evidence-grounded AI for the
            AcquiTwin student/research
            prototype. Missing data is
            not invented.
          </small>

        </section>

      </aside>

    </>
  );
}