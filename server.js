require('dotenv').config(); // Carrega as variáveis de ambiente do arquivo .env

const express = require('express');
const { MercadoPagoConfig, Preference, Payment } = require('mercadopago'); 
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000; 

// --- CONFIGURAÇÕES IMPORTANTES ---
const YOUR_FRONTEND_RENDER_URL = "https://acaiemcasasite.onrender.com"; 
const YOUR_BACKEND_RENDER_URL = "https://apihook.onrender.com"; 

const client = new MercadoPagoConfig({
    accessToken: process.env.MERCADOPAGO_ACCESS_TOKEN 
});
const preference = new Preference(client);
const payment = new Payment(client);


// Middleware para habilitar CORS
app.use(cors({
    origin: YOUR_FRONTEND_RENDER_URL 
})); 

// Middleware para parsear o corpo das requisições como JSON
app.use(express.json());

// Rota para criar um pagamento Pix
app.post('/create-mercadopago-pix', async (req, res) => {
    try {
        const { customerName, cartItems, delivery, totalAmount, externalReference } = req.body;

        if (!customerName || !cartItems || cartItems.length === 0 || !totalAmount || !externalReference) {
            console.error('Dados do pedido incompletos na requisição Pix:', req.body);
            return res.status(400).json({ status: 'error', message: 'Dados do pedido incompletos.' });
        }

        const items = cartItems.map(item => ({
            title: item.productName,
            unit_price: parseFloat(item.productPrice.toFixed(2)), 
            quantity: 1, 
            description: item.complements && item.complements.length > 0 
                         ? 'Com: ' + item.complements.map(c => c.name).join(', ') 
                         : 'Sem complementos'
        }));

        if (delivery && delivery.cost > 0) {
            items.push({
                title: "Taxa de Entrega",
                unit_price: parseFloat(delivery.cost.toFixed(2)),
                quantity: 1
            });
        }
        
        const preferenceBody = {
            items: items,
            payer: {
                name: customerName,
                // Opcional, mas útil para o Mercado Pago e para o Pix
                // Se você não coleta o email, pode deixar vazio ou um dummy
                email: "comprador@email.com" 
            },
            notification_url: `${YOUR_BACKEND_RENDER_URL}/mercadopago-webhook`, 
            
            back_urls: {
                success: `${YOUR_FRONTEND_RENDER_URL}/`,
                failure: `${YOUR_FRONTEND_RENDER_URL}/`, 
                pending: `${YOUR_FRONTEND_RENDER_URL}/` 
            },
            auto_return: "approved", 
            
            payment_methods: {
                // Remove credit_card e debit_card do excluded_payment_types para usar excluded_payment_methods
                excluded_payment_types: [
                    { id: "ticket" } // Exclui boleto
                ],
                excluded_payment_methods: [
                    // Excluir métodos de cartão de crédito e débito explicitamente, se necessário.
                    // Em geral, para Pix transparente, basta focar no local_payment_id.
                ],
                installments: 1 // Pix é sempre à vista
            },
            external_reference: externalReference,
            
            // --- ADIÇÃO CRÍTICA PARA OBTER DADOS DO PIX TRANSPARENTE ---
            // Indica o método de processamento do pagamento (Pix)
            processing_modes: ["aggregator"], // Ou "gateway" dependendo da sua conta/setup
            // Específica o método de pagamento local (Pix)
            // local_payment_id: "pix", // API antiga, pode não ser necessária com payment_methods.excluded_payment_types
            
            // Uma das formas de forçar o Pix e obter o point_of_interaction
            // É garantir que apenas o payment_type 'pix' seja válido
            // O ideal é não usar excluded_payment_types, mas sim 'default_payment_method_id' ou similar
            // Para garantir que venha o PIX:
            payment_methods: {
                default_payment_method_id: null, // Para não forçar cartão
                excluded_payment_types: [
                    { id: "credit_card" },
                    { id: "debit_card" },
                    { id: "ticket" }
                ],
                // Ou, uma abordagem melhor é forçar PIX com "transaction_data.qr_code" diretamente
                // Mas para Preferences, a estrutura é a que temos.
            },
            // Em algumas APIs do Mercado Pago, a propriedade `binary_mode: true` e a inclusão de email
            // são importantes para o retorno do point_of_interaction.

            // Vou refatorar a section payment_methods e adicionar o campo email, pois estes podem influenciar o retorno.
            payer: {
                name: customerName,
                email: "test_user_123456@test.com" // Email é frequentemente obrigatório ou recomendado. Use um email dummy se não coletar do cliente.
            },
            // A prioridade agora é ter certeza que a SDK está focando no Pix.
            // Para Checkout API transparente de Pix, não usamos Preferences.
            // O erro "point_of_interaction" geralmente ocorre com Payments API ou Checkout Pro,
            // mas para Preferences, a documentação implica que ele *deveria* estar lá para Pix.
            // A chave pode ser o `items` e a `payer` information, ou o `binary_mode`.

            // Vamos tentar adicionar binary_mode:
            binary_mode: true, // Isso força que a transação seja aprovada ou rejeitada imediatamente, sem pendência.
                               // Ajuda o Mercado Pago a saber que é para um fluxo de pagamento direto.

        };

        // --- NOVO LOG: O que está sendo enviado para o Mercado Pago ---
        console.log('Dados enviados ao Mercado Pago (preferenceBody):', JSON.stringify(preferenceBody, null, 2));


        const response = await preference.create({ body: preferenceBody });
        
        // --- NOVO LOG: Resposta COMPLETA do Mercado Pago ---
        console.log('Resposta COMPLETA do Mercado Pago:', JSON.stringify(response, null, 2));


        // Verifica se a estrutura esperada existe antes de tentar acessá-la
        if (!response || !response.body || !response.body.point_of_interaction || !response.body.point_of_interaction.transaction_data) {
            console.error('Estrutura de resposta inesperada do Mercado Pago (falha no point_of_interaction):', JSON.stringify(response, null, 2));
            return res.status(500).json({ 
                status: 'error', 
                message: 'Resposta do Mercado Pago não contém dados de Pix esperados.', 
                details: response ? (response.body || response) : 'Resposta vazia.' 
            });
        }

        const pixInfo = response.body.point_of_interaction.transaction_data;

        res.status(200).json({
            status: 'success',
            message: 'Preferência de pagamento Pix criada com sucesso.',
            paymentId: response.body.id, 
            qr_code_base64: pixInfo.qr_code_base64, 
            qr_code: pixInfo.qr_code,             
        });

    } catch (error) {
        console.error('Erro geral na rota /create-mercadopago-pix:', 
            error.response ? error.response.data : error.message, 
            error.response ? `HTTP Status: ${error.response.status}` : '' 
        );
        res.status(500).json({ 
            status: 'error', 
            message: 'Erro ao processar o pagamento com Mercado Pago. Tente novamente.', 
            details: error.response ? (error.response.data || error.message) : error.message 
        });
    }
});

// Rota de Webhook para receber notificações do Mercado Pago
app.post('/mercadopago-webhook', async (req, res) => {
    console.log(`--- Webhook do Mercado Pago recebido (Timestamp: ${new Date().toISOString()}) ---`);
    console.log('Query Params (topic, id):', req.query); 
    console.log('Corpo da Requisição Webhook:', req.body); 

    if (req.query.topic === 'payment') {
        const paymentId = req.query.id; 

        try {
            const paymentDetails = await payment.get({ id: paymentId }); 
            const paymentStatus = paymentDetails.body.status; 
            const externalReference = paymentDetails.body.external_reference; 

            console.log(`Detalhes do Pagamento ID: ${paymentId}`);
            console.log(`Status do Pagamento: ${paymentStatus}`);
            console.log(`Referência Externa (Seu Pedido ID): ${externalReference}`);

            if (paymentStatus === 'approved') {
                console.log(`✅ Pagamento APROVADO para pedido: ${externalReference}`);
            } else if (paymentStatus === 'pending') {
                console.log(`⏳ Pagamento PENDENTE para pedido: ${externalReference}`);
            } else {
                console.log(`❌ Pagamento ${paymentStatus} para pedido: ${externalReference}`);
            }

            res.status(200).send('Webhook recebido e processado.');

        } catch (error) {
            console.error('Erro ao processar webhook do Mercado Pago para paymentId:', paymentId, error.response ? error.response.data : error.message);
            res.status(500).send('Erro interno ao processar webhook.');
        }
    } else {
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
    console.log(`Esta instância do backend deve estar em: ${YOUR_BACKEND_RENDER_URL}`);
});
