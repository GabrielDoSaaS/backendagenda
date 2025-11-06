const OpenAI = require("openai");

const calcularFrete = async (product) => {
  const { cepOrigem, cepDestino, pesoKg, alturaCm, larguraCm } = product;

  const openai = new OpenAI({
    baseURL: "https://openrouter.ai/api/v1",
    // Recomenda-se usar process.env.OPENROUTER_API_KEY
    apiKey:  "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", 
  });

  try {
    // 1️⃣ Cálculo base simples
    const distancia = Math.abs(parseInt(cepOrigem) - parseInt(cepDestino)) / 100000;
    const custoBase = 10;
    const custoPeso = pesoKg * 2.5;
    const custoDistancia = distancia * 0.05;
    const valorBruto = custoBase + custoPeso + custoDistancia;

    // 2️⃣ Ajuste com IA
    const prompt = `
      Você é um sistema de cálculo de frete dos Correios. 
      Recebe dados de peso, dimensões e distância estimada, e retorna um valor aproximado de frete.
      Dados:
      - Peso: ${pesoKg} kg
      - Dimensões: ${larguraCm}x${alturaCm} cm
      - Distância estimada: ${distancia.toFixed(2)} km
      - Valor base calculado: R$${valorBruto.toFixed(2)}

      Retorne **APENAS** um JSON com a seguinte estrutura, sem nenhum texto adicional ou marcadores de código:
      {"valor_estimado": número_em_reais}
    `;

    const completion = await openai.chat.completions.create({
      model: "meta-llama/llama-3.3-8b-instruct:free",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.5,
      max_tokens: 100,
    });

    const content = completion.choices[0].message.content;
    
    // =======================================================
    // 💥 CORREÇÃO: Limpar a string antes de fazer o parse
    // =======================================================
    let cleanedContent = content.trim();

    // 1. Remover marcadores de bloco de código Markdown se existirem
    if (cleanedContent.startsWith('```')) {
        // Remove `json` ou `javascript` e as três crases iniciais (` ```json\n`)
        cleanedContent = cleanedContent.replace(/^```(json|javascript)?\s*/i, '');
        // Remove as três crases finais (`\n```)
        cleanedContent = cleanedContent.replace(/```$/, '');
    }
    
    // 2. Tentar remover qualquer texto antes de '{' 
    const firstBrace = cleanedContent.indexOf('{');
    if (firstBrace > 0) {
        cleanedContent = cleanedContent.substring(firstBrace);
    }
    
    // 3. Remover espaços em branco iniciais/finais
    cleanedContent = cleanedContent.trim();
    // =======================================================

    const result = JSON.parse(cleanedContent);

    return {
      servico: "Correios",
      valor_estimado: Number(result.valor_estimado),
    };
  } catch (error) {
    console.error("Erro ao calcular frete:", error.message);
    throw new Error(`Falha ao calcular o frete aqui: ${error.message}`);
  }
};


module.exports = calcularFrete;