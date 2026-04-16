import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { config } from '../config';
import { CATEGORY_BENCHMARK_MAP } from '../constants/evalCategories';
import logger from '../utils/logger';

// ---------------------------------------------------------------------------
// Type definitions
// ---------------------------------------------------------------------------

export interface TaskInfo {
  name: string;
  path: string;
  taskArgs: Record<string, unknown>;
}

export interface BenchmarkInfo {
  name: string;
  source: string;
  module: string;
  python: string;
  judgeModel?: string;
  needsDocker: boolean;
  tasks: TaskInfo[];
}

export interface BenchmarkMeta {
  displayName: string;
  displayNameEn: string;
  description: string;
  descriptionEn: string;
  reference: string;
  paperTitle: string;
  paperUrl: string;
  paperVenue: string;
  summary: string;
  summaryEn: string;
}

export interface TaskMeta {
  displayName: string;
  displayNameEn: string;
  description: string;
  descriptionEn: string;
}

export interface BenchmarkDetail extends BenchmarkInfo {
  meta: BenchmarkMeta | null;
}

// ---------------------------------------------------------------------------
// Catalog YAML parsing & cache
// ---------------------------------------------------------------------------

interface CatalogYamlTask {
  name: string;
  path?: string;
  task_args?: Record<string, unknown>;
  model_roles?: Record<string, string>;
}

interface CatalogYamlBenchmark {
  source?: string;
  module?: string;
  python?: string;
  judge_model?: string;
  judge_param?: string;
  needs_docker?: boolean;
  extras?: string[];
  model_roles?: Record<string, string>;
  tasks?: CatalogYamlTask[];
}

interface CatalogYamlModelDef {
  provider?: string;
  base_url?: string;
  api_key_env?: string;
}

interface CatalogYaml {
  benchmarks?: Record<string, CatalogYamlBenchmark>;
  models?: Record<string, CatalogYamlModelDef>;
}

/** Full benchmark config for the eval runner (includes fields not exposed to API) */
export interface BenchmarkConfig {
  name: string;
  source: string;
  module: string;
  python: string;
  judgeModel?: string;
  judgeParam?: string;
  needsDocker: boolean;
  extras: string[];
  modelRoles: Record<string, string>;
  tasks: TaskInfo[];
}

let cachedBenchmarks: BenchmarkInfo[] | null = null;
let cachedRawData: CatalogYaml | null = null;

function loadRawCatalog(): CatalogYaml {
  if (cachedRawData) return cachedRawData;

  const catalogPath = path.join(config.evalPocRoot, 'benchmarks', 'catalog.yaml');
  if (!fs.existsSync(catalogPath)) {
    logger.warn('catalog.yaml not found at', catalogPath);
    cachedRawData = {};
    return cachedRawData;
  }

  try {
    const raw = fs.readFileSync(catalogPath, 'utf-8');
    cachedRawData = (yaml.load(raw) as CatalogYaml) || {};
    return cachedRawData;
  } catch (err: any) {
    logger.error('Failed to parse catalog.yaml:', err.message);
    cachedRawData = {};
    return cachedRawData;
  }
}

function loadCatalog(): BenchmarkInfo[] {
  if (cachedBenchmarks) {
    return cachedBenchmarks;
  }

  const data = loadRawCatalog();
  const benchmarksMap = data?.benchmarks ?? {};

  const benchmarks: BenchmarkInfo[] = [];

  for (const [name, cfg] of Object.entries(benchmarksMap)) {
    const tasks: TaskInfo[] = (cfg.tasks ?? []).map((t) => ({
      name: t.name,
      path: t.path ?? '',
      taskArgs: t.task_args ?? {},
    }));

    benchmarks.push({
      name,
      source: cfg.source ?? 'upstream',
      module: cfg.module ?? '',
      python: cfg.python ?? '3.10',
      judgeModel: cfg.judge_model,
      needsDocker: cfg.needs_docker ?? false,
      tasks,
    });
  }

  cachedBenchmarks = benchmarks;
  logger.info(`Loaded ${benchmarks.length} benchmarks from catalog.yaml`);
  return cachedBenchmarks;
}

// ---------------------------------------------------------------------------
// BENCHMARK_META  (ported from catalog_service.py for 4 priority categories)
// ---------------------------------------------------------------------------

const BENCHMARK_META: Record<string, BenchmarkMeta> = {
  // === tool_calling ===
  agentdojo: {
    displayName: '智能体安全测试 (AgentDojo)',
    displayNameEn: 'AgentDojo',
    description: '智能体在工具调用场景下被攻击或产生危险行为的风险',
    descriptionEn: 'Risk of agents being attacked or producing dangerous behaviors in tool-calling scenarios',
    reference: 'https://github.com/ethz-spylab/agentdojo',
    paperTitle: 'AgentDojo: A Dynamic Environment to Evaluate Prompt Injection Attacks and Defenses for LLM Agents',
    paperUrl: 'https://arxiv.org/abs/2406.13352',
    paperVenue: 'NeurIPS 2024',
    summary: '97个用户任务+629个安全测试，覆盖5个工具场景（邮件日历、Slack消息、旅行预订、银行交易等）。三维评估：无攻击功能性、攻击下功能性和安全性。',
    summaryEn: '97 user tasks + 629 security tests across 5 tool suites (workspace, Slack, travel, banking, etc.). Three-dimensional evaluation: benign utility, utility under attack, and security.',
  },
  bfcl: {
    displayName: '函数调用评测 (BFCL)',
    displayNameEn: 'BFCL',
    description: '模型在函数调用中产生错误或危险调用的风险',
    descriptionEn: 'Risk of the model producing incorrect or dangerous function calls',
    reference: 'https://github.com/ShishirPatil/gorilla',
    paperTitle: 'The Berkeley Function Calling Leaderboard',
    paperUrl: '',
    paperVenue: 'ICML 2025',
    summary: '评估LLM的函数调用（工具使用）能力，使用AST结构化评估方法检查每个调用的正确性。覆盖串行/并行调用、多语言和多轮有状态对话。',
    summaryEn: 'Evaluates LLM function-calling (tool-use) capabilities using AST-based structural evaluation. Covers serial/parallel calls, multiple programming languages, and multi-turn stateful conversations.',
  },
  b3: {
    displayName: '综合智能体安全评测 (B3)',
    displayNameEn: 'B3',
    description: '智能体面临直接和间接提示词注入的综合安全风险',
    descriptionEn: 'Comprehensive security risk of agents facing direct and indirect prompt injection attacks',
    reference: 'https://github.com/UKGovernmentBEIS/inspect_evals',
    paperTitle: 'Breaking Agent Backbones: Evaluating the Security of Backbone LLMs in AI Agents',
    paperUrl: 'https://arxiv.org/abs/2510.22620',
    paperVenue: 'ICLR 2026',
    summary: '10个智能体威胁快照+19,433条众包对抗攻击（来自Gandalf红队游戏19.4万条尝试），覆盖数据泄露、内容注入、行为操纵等攻击类别。',
    summaryEn: '10 agent threat snapshots + 19,433 crowdsourced adversarial attacks (from 194K Gandalf red-teaming attempts) covering data exfiltration, content injection, behavior manipulation, and more.',
  },
  agentharm: {
    displayName: '智能体危害测试 (AgentHarm)',
    displayNameEn: 'AgentHarm',
    description: '智能体可能执行有害任务的风险',
    descriptionEn: 'Risk of agents executing harmful tasks',
    reference: 'https://github.com/UKGovernmentBEIS/inspect_evals',
    paperTitle: 'AgentHarm: A Benchmark for Measuring Harmfulness of LLM Agents',
    paperUrl: 'https://arxiv.org/abs/2410.09024',
    paperVenue: 'ICLR 2025',
    summary: '110个恶意智能体任务（含增强共440个），覆盖欺诈、网络犯罪、骚扰等11类危害。测试模型是否拒绝执行有害多步任务。发现领先LLM在无越狱情况下对恶意请求惊人地合规。',
    summaryEn: '110 malicious agent tasks (440 with augmentations) across 11 harm categories (fraud, cybercrime, harassment, etc.). Tests refusal of harmful multi-step tasks. Finding: leading LLMs are surprisingly compliant with malicious requests even without jailbreaking.',
  },
  open_agent_safety: {
    displayName: '开放智能体安全 (OpenAgentSafety)',
    displayNameEn: 'OpenAgentSafety',
    description: '开放式智能体在长链调用中产生安全问题的风险',
    descriptionEn: 'Risk of open-ended agents producing safety issues in long-chain tool calls',
    reference: 'https://github.com/sani903/OpenAgentSafety',
    paperTitle: 'OpenAgentSafety: A Comprehensive Framework for Evaluating Real-World AI Agent Safety',
    paperUrl: 'https://arxiv.org/abs/2507.06134',
    paperVenue: 'arXiv, 2025',
    summary: '8类关键风险，350+多轮多用户任务，智能体在真实工具环境（浏览器、代码执行、文件系统、消息平台）中运行。实测不安全行为率：Claude 51.2% 至 o3-mini 72.7%。',
    summaryEn: '8 risk categories, 350+ multi-turn multi-user tasks with real tools (browser, code execution, file system, messaging). Measured unsafe behavior rates: Claude 51.2% to o3-mini 72.7%.',
  },

  // === rag_safety ===
  saferag: {
    displayName: 'RAG 安全评测 (SafeRAG)',
    displayNameEn: 'SafeRAG',
    description: '检索增强生成系统被知识库投毒攻击的风险',
    descriptionEn: 'Risk of retrieval-augmented generation systems being compromised by knowledge base poisoning attacks',
    reference: 'https://github.com/IAAR-Shanghai/SafeRAG',
    paperTitle: 'SafeRAG: Benchmarking Security in Retrieval-Augmented Generation of Large Language Model',
    paperUrl: 'https://arxiv.org/abs/2501.18636',
    paperVenue: 'ACL 2025',
    summary: '4类攻击任务（银色噪声注入、上下文冲突、软广告注入、白色拒绝服务），手工构造数据集，测试14个代表性RAG组件的安全性。',
    summaryEn: '4 attack types (silver noise injection, inter-context conflict, soft advertising, white denial-of-service). Manually constructed dataset testing security of 14 representative RAG components.',
  },
  clash_eval: {
    displayName: '知识冲突评测 (ClashEval)',
    displayNameEn: 'ClashEval',
    description: '模型面对矛盾信息时产生错误推断的风险',
    descriptionEn: 'Risk of the model making incorrect inferences when facing contradictory information',
    reference: 'https://github.com/kevinwu23/StanfordClashEval',
    paperTitle: 'ClashEval: Quantifying the tug-of-war between an LLM\'s internal prior and external evidence',
    paperUrl: 'https://arxiv.org/abs/2404.10198',
    paperVenue: 'NeurIPS 2024',
    summary: '1,200+道题覆盖6个领域（药物剂量、奥运记录等），检索段落含精确扰动的错误信息（从细微到明显）。评估RAG场景下模型是否采纳错误检索内容。',
    summaryEn: '1,200+ questions across 6 domains with precisely perturbed retrieved passages (subtle to blatant errors). Evaluates whether models adopt incorrect retrieved content in RAG settings.',
  },

  // === task_planning ===
  safeagentbench: {
    displayName: '任务规划安全评测 (SafeAgentBench)',
    displayNameEn: 'SafeAgentBench',
    description: '智能体在复杂任务规划中生成危险步骤的风险',
    descriptionEn: 'Risk of agents generating dangerous steps in complex task planning',
    reference: 'https://github.com/SafeAgentBench/SafeAgentBench',
    paperTitle: 'SafeAgentBench: A Benchmark for Safe Task Planning of Embodied LLM Agents',
    paperUrl: 'https://arxiv.org/abs/2412.13178',
    paperVenue: 'arXiv, 2024',
    summary: '首个具身智能体安全任务规划评测。AI2-THOR模拟环境中750个任务，覆盖10类潜在危害x3类任务（安全/显式危害/隐式危害），17个高级动作。最优基线安全任务成功率69%但危害任务拒绝率仅5-10%。',
    summaryEn: 'First embodied agent safe task planning benchmark. 750 tasks in AI2-THOR covering 10 hazards x 3 task types (safe/explicit/implicit hazard), 17 high-level actions. Best baseline: 69% safe task success but only 5-10% hazard rejection.',
  },
  gaia: {
    displayName: '通用 AI 助手评测 (GAIA)',
    displayNameEn: 'GAIA',
    description: '通用 AI 助手在任务执行中产生安全问题的风险',
    descriptionEn: 'Risk of general AI assistants producing safety issues during task execution',
    reference: 'https://huggingface.co/gaia-benchmark',
    paperTitle: 'GAIA: a benchmark for General AI Assistants',
    paperUrl: 'https://arxiv.org/abs/2311.12983',
    paperVenue: 'ICLR 2024',
    summary: '466个真实问题需要推理、多模态处理、网页浏览和工具使用。人类92%准确率，GPT-4+插件仅15%。分3个难度级别。',
    summaryEn: '466 real-world questions requiring reasoning, multimodality, web browsing, and tool use. Humans: 92%; GPT-4 with plugins: 15%. Three difficulty levels.',
  },
  mind2web: {
    displayName: '网页交互规划 (Mind2Web)',
    displayNameEn: 'Mind2Web',
    description: '模型在网页交互任务中执行不当操作的风险',
    descriptionEn: 'Risk of the model executing improper actions in web interaction tasks',
    reference: 'https://github.com/OSU-NLP-Group/Mind2Web',
    paperTitle: 'Mind2Web: Towards a Generalist Agent for the Web',
    paperUrl: 'https://arxiv.org/abs/2306.06070',
    paperVenue: 'NeurIPS 2023 (Spotlight)',
    summary: '首个通用Web代理数据集。2,350个任务覆盖137个真实网站31个领域，含众包的动作序列（点击/输入/选择）。基于真实网页HTML评估。',
    summaryEn: 'First dataset for generalist web agents. 2,350 tasks from 137 real websites across 31 domains with crowdsourced action sequences (click/type/select) on actual website HTML.',
  },
  mind2web_sc: {
    displayName: '网页交互安全约束 (Mind2Web-SC)',
    displayNameEn: 'Mind2Web-SC',
    description: '模型在网页交互中违反安全约束的风险',
    descriptionEn: 'Risk of the model violating safety constraints in web interactions',
    reference: 'https://github.com/UKGovernmentBEIS/inspect_evals',
    paperTitle: 'GuardAgent: Safeguard LLM Agents by a Guard Agent via Knowledge-Enabled Reasoning',
    paperUrl: 'https://arxiv.org/abs/2406.09187',
    paperVenue: 'ICML 2025',
    summary: '基于Mind2Web添加安全控制规则（会员要求、年龄限制、地域限制等6类安全策略）。评估安全守护系统能否在不影响任务性能的前提下拦截违规操作。',
    summaryEn: 'Mind2Web augmented with 6 safety policy rules (membership, age, geographic restrictions, etc.). Evaluates whether guard systems can block policy-violating actions without degrading task performance.',
  },
  assistant_bench: {
    displayName: 'AI 助手任务评测 (AssistantBench)',
    displayNameEn: 'AssistantBench',
    description: 'AI 助手执行任务时产生安全问题的风险',
    descriptionEn: 'Risk of AI assistants producing safety issues during task execution',
    reference: 'https://github.com/oriyor/assistantbench',
    paperTitle: 'AssistantBench: Can Web Agents Solve Realistic and Time-Consuming Tasks?',
    paperUrl: 'https://arxiv.org/abs/2407.15711',
    paperVenue: 'EMNLP 2024',
    summary: '214个耗时的真实Web任务（如房产市场监控、商家查找），覆盖258个网站。答案可自动验证。最优模型不超过26%准确率。',
    summaryEn: '214 realistic, time-consuming web tasks (real-estate monitoring, business locating, etc.) across 258 websites. Automatically verifiable answers. No model exceeds 26% accuracy.',
  },

  // === business_safety ===
  raccoon: {
    displayName: '提示词提取防护 (Raccoon)',
    displayNameEn: 'Raccoon',
    description: '模型系统提示词被提取泄露的风险',
    descriptionEn: 'Risk of the model\'s system prompt being extracted and leaked',
    reference: 'https://github.com/M0gician/RaccoonBench',
    paperTitle: 'Raccoon: Prompt Extraction Benchmark of LLM-Integrated Applications',
    paperUrl: 'https://arxiv.org/abs/2406.06737',
    paperVenue: 'ACL 2024 Findings',
    summary: '14类提示词提取攻击+组合多策略攻击，配合多样化防御模板。在有防御和无防御场景下双重评估模型的提示词保密能力。',
    summaryEn: '14 categories of prompt extraction attacks + compounded multi-strategy attacks with diverse defense templates. Dual evaluation in defenseless and defended scenarios.',
  },
  healthbench: {
    displayName: '医疗健康评测 (HealthBench)',
    displayNameEn: 'HealthBench',
    description: '模型在医疗健康场景中提供不准确或不安全信息的风险',
    descriptionEn: 'Risk of the model providing inaccurate or unsafe information in healthcare scenarios',
    reference: 'https://github.com/openai/simple-evals',
    paperTitle: 'HealthBench: Evaluating Large Language Models Towards Improved Human Health',
    paperUrl: 'https://arxiv.org/abs/2505.08775',
    paperVenue: 'OpenAI, 2025',
    summary: '5,000段多轮医疗对话，48,562条由262名医生编写的评分标准，覆盖急救、全球健康、临床文档等场景。分标准/困难/共识3个子集。',
    summaryEn: '5,000 multi-turn healthcare dialogues with 48,562 physician-written rubric criteria from 262 doctors. Covers emergencies, global health, clinical documentation. Three variants: standard, hard, consensus.',
  },
  truthfulqa: {
    displayName: '真实性评估 (TruthfulQA)',
    displayNameEn: 'TruthfulQA',
    description: '模型回答偏离事实真相的风险',
    descriptionEn: 'Risk of the model\'s answers deviating from factual truth',
    reference: 'https://github.com/sylinrl/TruthfulQA',
    paperTitle: 'TruthfulQA: Measuring How Models Mimic Human Falsehoods',
    paperUrl: 'https://arxiv.org/abs/2109.07958',
    paperVenue: 'ACL 2022',
    summary: '817道题覆盖38个类别（健康、法律、金融、阴谋论等），专门测试模型是否生成真实答案而非复述人类常见错误认知。含生成和选择两种任务。',
    summaryEn: '817 questions across 38 categories (health, law, finance, conspiracies, etc.) testing whether models generate truthful answers rather than reproducing common human misconceptions. Both generation and multiple-choice tasks.',
  },
  gdpval: {
    displayName: 'GDP 验证评测 (GDPval)',
    displayNameEn: 'GDPval',
    description: '模型在业务数据验证场景中产生错误判断的风险',
    descriptionEn: 'Risk of the model making incorrect judgments in business data validation scenarios',
    reference: 'https://github.com/openai/simple-evals',
    paperTitle: 'GDPval: Evaluating AI Model Performance on Real-World Economically Valuable Tasks',
    paperUrl: 'https://arxiv.org/abs/2510.04374',
    paperVenue: 'OpenAI, 2025',
    summary: '1,320个任务覆盖美国GDP贡献前9大行业的44个职业（法律、工程、护理等），由平均14年经验的专业人士基于真实工作成果构造。',
    summaryEn: '1,320 tasks across 44 occupations in top 9 US GDP sectors (legal, engineering, nursing, etc.), crafted by professionals averaging 14 years of experience based on real work products.',
  },
};

// ---------------------------------------------------------------------------
// TASK_META  (ported from catalog_service.py for 4 priority categories)
// ---------------------------------------------------------------------------

const TASK_META: Record<string, TaskMeta> = {
  // --- tool_calling ---
  agentdojo: { displayName: '工具调用安全', displayNameEn: 'Tool Call Safety', description: '智能体在工具调用场景下被攻击利用的风险', descriptionEn: 'Risk of agents being attacked and exploited in tool-calling scenarios' },
  bfcl: { displayName: '函数调用错误', displayNameEn: 'Function Call Errors', description: '函数调用参数错误或调用不当的安全风险', descriptionEn: 'Safety risk of incorrect function call parameters or improper invocations' },
  b3: { displayName: '综合智能体安全', displayNameEn: 'Comprehensive Agent Safety', description: '智能体面临直接和间接提示词注入的综合安全风险', descriptionEn: 'Comprehensive security risk of agents facing direct and indirect prompt injection attacks' },
  agentharm: { displayName: '有害任务执行', displayNameEn: 'Harmful Task Execution', description: '智能体执行有害任务而未拒绝的风险', descriptionEn: 'Risk of agents executing harmful tasks without refusing' },
  agentharm_benign: { displayName: '良性任务误拒', displayNameEn: 'Benign Task False Refusal', description: '智能体错误拒绝良性任务的风险', descriptionEn: 'Risk of agents incorrectly refusing benign tasks' },
  open_agent_safety: { displayName: '长链调用安全', displayNameEn: 'Long-Chain Call Safety', description: '智能体在长链工具调用中产生安全问题的风险', descriptionEn: 'Risk of agents producing safety issues in long-chain tool calls' },

  // --- rag_safety ---
  saferag_sn: { displayName: 'RAG 噪声注入', displayNameEn: 'RAG Noise Injection', description: '检索结果中注入安全噪声的攻击风险', descriptionEn: 'Risk of safety noise injection attacks in retrieval results' },
  saferag_icc: { displayName: 'RAG 上下文冲突', displayNameEn: 'RAG Context Conflict', description: '检索结果中矛盾信息导致错误输出的风险', descriptionEn: 'Risk of contradictory information in retrieval results leading to incorrect outputs' },
  saferag_sa: { displayName: 'RAG 安全攻击', displayNameEn: 'RAG Security Attack', description: '检索增强生成系统被安全攻击的风险', descriptionEn: 'Risk of retrieval-augmented generation systems being compromised by security attacks' },
  saferag_wdos: { displayName: 'RAG 拒绝服务', displayNameEn: 'RAG Denial of Service', description: '检索增强生成系统被拒绝服务攻击的风险', descriptionEn: 'Risk of retrieval-augmented generation systems being targeted by denial-of-service attacks' },
  clash_eval: { displayName: '知识冲突', displayNameEn: 'Knowledge Conflict', description: '面对矛盾信息做出错误推断的风险', descriptionEn: 'Risk of making incorrect inferences when facing contradictory information' },

  // --- task_planning ---
  safeagentbench: { displayName: '规划安全风险', displayNameEn: 'Planning Safety Risk', description: '复杂任务规划中生成危险步骤的风险', descriptionEn: 'Risk of generating dangerous steps in complex task planning' },
  safeagentbench_react: { displayName: 'ReAct 规划风险', displayNameEn: 'ReAct Planning Risk', description: 'ReAct 模式下任务规划产生危险行为的风险', descriptionEn: 'Risk of dangerous behaviors in task planning under ReAct mode' },
  safeagentbench_visual: { displayName: '视觉规划风险', displayNameEn: 'Visual Planning Risk', description: '视觉辅助任务规划中产生危险行为的风险', descriptionEn: 'Risk of dangerous behaviors in visually-assisted task planning' },
  gaia: { displayName: '通用助手风险', displayNameEn: 'General Assistant Risk', description: '通用 AI 助手在任务执行中产生安全问题的风险', descriptionEn: 'Risk of general AI assistants producing safety issues during task execution' },
  mind2web: { displayName: '网页交互风险', displayNameEn: 'Web Interaction Risk', description: '网页交互任务中执行不当操作的风险', descriptionEn: 'Risk of executing improper actions in web interaction tasks' },
  mind2web_sc: { displayName: '安全约束违反', displayNameEn: 'Safety Constraint Violation', description: '网页交互中违反安全约束的风险', descriptionEn: 'Risk of violating safety constraints in web interactions' },
  assistant_bench: { displayName: '助手任务风险', displayNameEn: 'Assistant Task Risk', description: 'AI 助手执行任务时产生安全问题的风险', descriptionEn: 'Risk of AI assistants producing safety issues during task execution' },
  assistant_bench_closed_book_zero_shot: { displayName: '助手任务（闭卷零样本）', displayNameEn: 'Assistant Task (Closed Book Zero-Shot)', description: '无外部工具且无示例场景下的助手任务安全评测', descriptionEn: 'Assistant task safety evaluation without external tools or examples' },
  assistant_bench_closed_book: { displayName: '助手任务（闭卷）', displayNameEn: 'Assistant Task (Closed Book)', description: '无外部工具场景下的助手任务安全评测', descriptionEn: 'Assistant task safety evaluation without external tools' },
  assistant_bench_web_browser: { displayName: '助手任务（浏览器）', displayNameEn: 'Assistant Task (Web Browser)', description: '使用网页浏览器场景下的助手任务安全评测', descriptionEn: 'Assistant task safety with web browser' },

  // --- business_safety ---
  raccoon: { displayName: '提示词泄露', displayNameEn: 'Prompt Leakage', description: '系统提示词被攻击者提取泄露的风险', descriptionEn: 'Risk of system prompts being extracted and leaked by attackers' },
  healthbench: { displayName: '医疗建议风险', displayNameEn: 'Medical Advice Risk', description: '医疗健康建议不准确导致的安全风险', descriptionEn: 'Safety risk of inaccurate medical and health advice' },
  healthbench_hard: { displayName: '医疗建议风险（高难度）', displayNameEn: 'Medical Advice Risk (Hard)', description: '复杂医疗场景下建议不准确的安全风险', descriptionEn: 'Safety risk of inaccurate advice in complex medical scenarios' },
  healthbench_consensus: { displayName: '医疗共识偏差', displayNameEn: 'Medical Consensus Deviation', description: '偏离医学共识导致错误医疗建议的风险', descriptionEn: 'Risk of deviating from medical consensus leading to incorrect medical advice' },
  truthfulqa: { displayName: '事实偏差', displayNameEn: 'Factual Deviation', description: '模型回答偏离事实真相的风险', descriptionEn: "Risk of the model's answers deviating from factual truth" },
  gdpval: { displayName: '业务数据错误', displayNameEn: 'Business Data Errors', description: '业务数据验证场景中产生错误判断的风险', descriptionEn: 'Risk of incorrect judgments in business data validation scenarios' },
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export const catalogService = {
  /**
   * Returns all benchmarks parsed from catalog.yaml.
   */
  getAllBenchmarks(): BenchmarkDetail[] {
    const benchmarks = loadCatalog();
    return benchmarks.map((b) => ({
      ...b,
      meta: BENCHMARK_META[b.name] ?? null,
    }));
  },

  /**
   * Returns benchmarks belonging to a given evaluation category.
   * Uses CATEGORY_BENCHMARK_MAP to filter.
   */
  getBenchmarksByCategory(category: string): BenchmarkDetail[] {
    const benchmarkNames = CATEGORY_BENCHMARK_MAP[category];
    if (!benchmarkNames) {
      return [];
    }
    const all = loadCatalog();
    const nameSet = new Set(benchmarkNames);
    return all
      .filter((b) => nameSet.has(b.name))
      .map((b) => ({
        ...b,
        meta: BENCHMARK_META[b.name] ?? null,
      }));
  },

  /**
   * Returns Chinese/English metadata for all tasks across
   * the 4 priority categories.
   */
  getTaskMeta(): Record<string, TaskMeta> {
    return { ...TASK_META };
  },

  /**
   * Returns metadata for a single benchmark by name.
   */
  getBenchmarkMeta(benchmarkName: string): BenchmarkMeta | null {
    return BENCHMARK_META[benchmarkName] ?? null;
  },

  /**
   * Returns the full config for a single benchmark (for eval runner).
   * Includes extras, judge_param, model_roles not exposed to the API.
   */
  getBenchmarkConfig(benchmarkName: string): BenchmarkConfig | null {
    const data = loadRawCatalog();
    const cfg = data?.benchmarks?.[benchmarkName];
    if (!cfg) return null;

    const tasks: TaskInfo[] = (cfg.tasks ?? []).map((t) => ({
      name: t.name,
      path: t.path ?? '',
      taskArgs: t.task_args ?? {},
    }));

    return {
      name: benchmarkName,
      source: cfg.source ?? 'upstream',
      module: cfg.module ?? '',
      python: cfg.python ?? '3.10',
      judgeModel: cfg.judge_model,
      judgeParam: cfg.judge_param,
      needsDocker: cfg.needs_docker ?? false,
      extras: cfg.extras ?? [],
      modelRoles: cfg.model_roles ?? {},
      tasks,
    };
  },

  /**
   * Returns the global models dict from catalog.yaml.
   * Used by environmentBuilder to resolve judge model short names.
   */
  getModels(): Record<string, CatalogYamlModelDef> {
    const data = loadRawCatalog();
    return data?.models ?? {};
  },
};

export default catalogService;
