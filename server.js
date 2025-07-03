require('dotenv').config(); // Carrega as variáveis de ambiente do arquivo .env

const express = require('express');
const mercadopago = require('mercadopago');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000; // Usa a porta do ambiente (Render) ou 3000 localmente

// --- CONFIGURAÇÕES IMPORTANTES ---
// **SUBSTITUA PELAS SUAS URLs REAIS DO RENDER**
const YOUR_FRONTEND_RENDER_URL = "https://acaiemcasasite.onrender.com/"; // Ex: https://acai-em-casa.onrender.com
const YOUR_BACKEND_RENDER_URL = "https://acaiemcasasite.onrender.com/"; // Ex: https://acai-backend.onrender.com

// Configuração do Mercado Pago
// Use o Access Token das suas credenciais de produção
// Este valor será carregado da variável de ambiente MERCADOPAGO_ACCESS_TOKEN
mercadopago.configure({
    access_token: process.env.MERCADOPAGO_ACCESS_TOKEN 
});

// Middleware para habilitar CORS
// IMPORTANTE: Em produção, você deve RESTRINGIR as origens para o domínio do seu frontend.
// Se seu frontend e backend estiverem no Render, ambos serão HTTPS.
app.use(cors({
    origin: YOUR_FRONTEND_RENDER_URL // Permite apenas requisições do seu frontend
})); 

// Middleware para parsear o corpo das requisições como JSON
app.use(express.json());

// Rota para criar um pagamento Pix
app.post('/create-mercadopago-pix', async (req, res) => {
    try {
        const { customerName, cartItems, delivery, totalAmount, externalReference } = req.body;

        // Validação básica dos dados recebidos
        if (!customerName || !cartItems || cartItems.length === 0 || !totalAmount || !externalReference) {
            console.error('Dados do pedido incompletos na requisição Pix:', req.body);
            return res.status(400).json({ status: 'error', message: 'Dados do pedido incompletos.' });
        }

        // Crie os itens da preferência de pagamento para o Mercado Pago
        const items = cartItems.map(item => ({
            title: item.productName,
            unit_price: parseFloat(item.productPrice.toFixed(2)), // Garante duas casas decimais
            quantity: 1, // Assumindo 1 unidade por item do carrinho para simplicidade
            // Opcional: Adicionar descrição dos complementos no item do MP
            description: item.complements && item.complements.length > 0 
                         ? 'Com: ' + item.complements.map(c => c.name).join(', ') 
                         : 'Sem complementos'
        }));

        // Adiciona custo de entrega como um item separado, se houver
        if (delivery && delivery.cost > 0) {
            items.push({
                title: "Taxa de Entrega",
                unit_price: parseFloat(delivery.cost.toFixed(2)),
                quantity: 1
            });
        }
        
        // Se houver uma taxa de cartão para pagamentos online no futuro, ela seria adicionada aqui como item.
        // Por enquanto, o Pix geralmente não tem taxa extra para o cliente.

        const preference = {
            items: items,
            payer: {
                name: customerName,
                // Opcional: Adicione mais dados do pagador se coletar no frontend
                // email: "email_do_cliente@example.com",
                // identification: { type: "CPF", number: "12345678900" } 
            },
            // MUITO IMPORTANTE: A URL do seu backend no Render para receber as notificações de pagamento
            notification_url: `${YOUR_BACKEND_RENDER_URL}/mercadopago-webhook`, 
            
            // back_urls não são estritamente necessárias para Pix transparente, 
            // mas é boa prática tê-las, mesmo que o cliente não seja redirecionado por elas.
            // O Mercado Pago pode tentar redirecionar em alguns casos ou se o fluxo for alterado.
            back_urls: {
                success: `${YOUR_FRONTEND_RENDER_URL}/`, // Página inicial do seu site
                failure: `${YOUR_FRONTEND_RENDER_URL}/`, 
                pending: `${YOUR_FRONTEND_RENDER_URL}/` 
            },
            auto_return: "approved", // Tenta redirecionar automaticamente se aprovado (para checkout padrão)
            
            // Configurações de métodos de pagamento para Pix
            payment_methods: {
                excluded_payment_types: [ // Exclui outros tipos de pagamento para focar no Pix
                    { id: "credit_card" },
                    { id: "debit_card" },
                    { id: "ticket" } // Boleto
                ],
                installments: 1 // Pix é sempre à vista
            },
            // A external_reference é crucial para você identificar o pedido no seu sistema
            external_reference: externalReference 
        };

        const response = await mercadopago.preferences.create(preference);
        
        // O Mercado Pago retorna a URL do QR Code e o código copia e cola para Pix
        // Estas informações vêm dentro de point_of_interaction.transaction_data para Pix
        const pixInfo = response.body.point_of_interaction.transaction_data;

        res.status(200).json({
            status: 'success',
            message: 'Preferência de pagamento Pix criada com sucesso.',
            paymentId: response.body.id, // ID da preferência do MP
            qr_code_base64: pixInfo.qr_code_base64, // Imagem do QR Code em base64 (para <img src="...">)
            qr_code: pixInfo.qr_code,             // Código Pix copia e cola
            // init_point: response.body.init_point // URL para o Checkout Pro (não usaremos aqui)
        });

    } catch (error) {
        // Erro detalhado para depuração
        console.error('Erro ao criar preferência de pagamento:', 
            error.response ? error.response.data : error.message,
            error.response ? error.response.status : ''
        );
        res.status(500).json({ 
            status: 'error', 
            message: 'Erro ao processar o pagamento com Mercado Pago. Tente novamente.', 
            details: error.response ? error.response.data : error.message 
        });
    }
});

// Rota de Webhook para receber notificações do Mercado Pago
// Esta rota será chamada pelo Mercado Pago quando o status de um pagamento mudar.
app.post('/mercadopago-webhook', async (req, res) => {
    console.log(`--- Webhook do Mercado Pago recebido (Timestamp: ${new Date().toISOString()}) ---`);
    console.log('Query Params (topic, id):', req.query); 
    console.log('Corpo da Requisição Webhook:', req.body); 

    // O Mercado Pago envia notificações para vários tópicos. O mais importante é 'payment'.
    if (req.query.topic === 'payment') {
        const paymentId = req.query.id; // Este é o ID do PAGAMENTO no Mercado Pago (não o ID da preferência)

        try {
            // Obtenha os detalhes completos do pagamento para confirmar o status
            const payment = await mercadopago.payment.findById(paymentId);
            const paymentStatus = payment.body.status; // status: approved, pending, rejected, refunded, cancelled
            const externalReference = payment.body.external_reference; // O 'PEDIDO_XXXX' que você passou

            console.log(`Detalhes do Pagamento ID: ${paymentId}`);
            console.log(`Status do Pagamento: ${paymentStatus}`);
            console.log(`Referência Externa (Seu Pedido ID): ${externalReference}`);

            // --- AQUI É ONDE VOCÊ INTEGRARIA COM SEU BANCO DE DADOS ---
            // Se você tiver um DB, este é o momento de atualizar o status do pedido
            // que tem a external_reference correspondente.

            if (paymentStatus === 'approved') {
                console.log(`✅ Pagamento APROVADO para pedido: ${externalReference}`);
                // Lógica pós-pagamento aprovado:
                // 1. Atualizar status do pedido no seu banco de dados para 'pago' / 'confirmado'.
                // 2. Notificar seu sistema interno de cozinha/expedição.
                // 3. Opcional: Enviar e-mail de confirmação para o cliente (se tiver o email).
                // 4. Se o cliente ainda estiver na página de checkout e com o modal Pix aberto,
                //    você pode usar WebSockets para notificá-lo em tempo real (mais avançado).
                //    Alternativamente, a próxima vez que ele recarregar, o carrinho estará limpo.

                // IMPORTANTE: Aqui você pode limpar o carrinho do cliente no frontend via localStorage.
                // No entanto, como o webhook é um processo de backend, você não tem acesso direto
                // ao localStorage do navegador do cliente. A limpeza do localStorage é melhor
                // feita no frontend, em uma "página de sucesso" simulada ou ao iniciar um novo pedido.
                // Para este exemplo, manteremos a limpeza manual ou na página de sucesso se você decidir usá-la.
                // Se não usar DB, o external_reference é apenas para registro no console/logs.

            } else if (paymentStatus === 'pending') {
                console.log(`⏳ Pagamento PENDENTE para pedido: ${externalReference}`);
                // Atualizar status do pedido para 'pendente' no seu DB.
            } else {
                console.log(`❌ Pagamento ${paymentStatus} para pedido: ${externalReference}`);
                // Atualizar status do pedido para 'rejeitado' / 'cancelado' no seu DB.
            }

            // IMPORTANTE: Sempre responda ao Mercado Pago com um 200 OK para indicar que você recebeu a notificação.
            res.status(200).send('Webhook recebido e processado.');

        } catch (error) {
            console.error('Erro ao processar webhook do Mercado Pago para paymentId:', paymentId, error.response ? error.response.data : error.message);
            res.status(500).send('Erro interno ao processar webhook.');
        }
    } else {
        // Notificações de outros tópicos (ex: merchant_order, chargebacks, etc.)
        // Você pode ignorá-los ou processá-los conforme sua necessidade.
        console.log(`Webhook recebido, mas tópico '${req.query.topic}' não é de pagamento. Ignorando.`);
        res.status(200).send('Webhook recebido, mas tópico não relevante para esta aplicação.');
    }
});

// Rota padrão para verificar se o servidor está funcionando
app.get('/', (req, res) => {
    res.send('Açaí Mercado Pago Backend está online!');
});

// Inicia o servidor
app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
    console.log(`Aguardando requisições em http://localhost:${PORT}`);
    console.log(`Seu frontend deve estar em: ${YOUR_FRONTEND_RENDER_URL}`);
    console.log(`Esta instância do backend está em: ${YOUR_BACKEND_RENDER_URL}`);
});