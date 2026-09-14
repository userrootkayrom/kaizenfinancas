const { onSchedule } = require("firebase-functions/v2/scheduler");
const { defineSecret } = require("firebase-functions/params");
const logger = require("firebase-functions/logger");
const admin = require("firebase-admin");

admin.initializeApp();

const db = admin.firestore();
const oneSignalRestApiKey = defineSecret("ONESIGNAL_REST_API_KEY");
const oneSignalAppId = "309c8689-b4b6-44ad-a708-36dbbc842cfe";
const reminderOffsets = [7, 5, 3, 0];
const reminderMessages = {
    7: "Sua conta vence em 7 dias. Já conferiu? 👀",
    5: "Faltam 5 dias para sua conta vencer. Não deixe para depois!",
    3: "Sua conta vence em 3 dias. Se organize para evitar atrasos.",
    0: "Tá esquecendo de pagar nada não? 👀"
};

function getDateInSaoPaulo(date = new Date()) {
    return new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Sao_Paulo",
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
    }).format(date);
}

async function sendOneSignalNotification(externalId, title, message) {
    const response = await fetch("https://api.onesignal.com/notifications", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Key ${oneSignalRestApiKey.value()}`
        },
        body: JSON.stringify({
            app_id: oneSignalAppId,
            target_channel: "push",
            include_aliases: {
                external_id: [externalId]
            },
            headings: { en: title },
            contents: { en: message }
        })
    });

    const responseText = await response.text();
    if (!response.ok) {
        throw new Error(`OneSignal HTTP ${response.status}: ${responseText}`);
    }

    return responseText ? JSON.parse(responseText) : null;
}

exports.sendDueDateReminders = onSchedule(
    {
        schedule: "every day 09:00",
        timeZone: "America/Sao_Paulo",
        region: "us-central1",
        secrets: [oneSignalRestApiKey],
        retryCount: 3
    },
    async () => {
        const today = getDateInSaoPaulo();
        const snapshot = await db.collection("transacoes")
            .where("type", "==", "expense")
            .where("status", "==", "pendente")
            .get();

        let sent = 0;
        let skipped = 0;

        for (const transactionDocument of snapshot.docs) {
            const transaction = transactionDocument.data();
            if (!transaction.userId || typeof transaction.dueDate !== "string") {
                skipped++;
                continue;
            }

            const daysUntilDue = Math.round(
                (new Date(`${transaction.dueDate}T12:00:00-03:00`) -
                    new Date(`${today}T12:00:00-03:00`)) / 86400000
            );
            if (!reminderOffsets.includes(daysUntilDue)) {
                skipped++;
                continue;
            }

            const reminderKey = `${transaction.dueDate}:${daysUntilDue}`;
            const sentReminders = transaction.notificationReminders || {};
            if (sentReminders[reminderKey]) {
                skipped++;
                continue;
            }

            const description = transaction.desc || "uma conta";
            const message = `${description}: ${reminderMessages[daysUntilDue]}`;

            try {
                await sendOneSignalNotification(
                    transaction.userId,
                    "Lembrete de pagamento",
                    message
                );
                await transactionDocument.ref.update({
                    [`notificationReminders.${reminderKey}`]: admin.firestore.FieldValue.serverTimestamp()
                });
                sent++;
            } catch (error) {
                logger.error("Falha ao enviar lembrete pelo OneSignal", {
                    transactionId: transactionDocument.id,
                    userId: transaction.userId,
                    error: error.message
                });
            }
        }

        logger.info("Processamento de lembretes concluído", { today, sent, skipped });
    }
);
