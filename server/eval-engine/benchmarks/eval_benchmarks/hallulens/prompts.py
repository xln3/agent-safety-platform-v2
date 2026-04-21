"""Prompt templates for HalluLens benchmark evaluation.

Extracted from vendor/HalluLens source code to support native inspect_ai scorers.
"""

# ==========================================================================
# Task 1: Precise WikiQA — Abstention detection
# ==========================================================================

ABSTAIN_PROMPT = """\
You are an AI assistant to help me determine whether an answer from a chatbot \
is a direct answer to a given prompt or if the chatbot is abstaining from \
answering. A chatbot abstains from answering when it says it does not know \
the answer to the question, or it tells the user to search for the answer \
on their own. If the chatbot attempts to correct the user's question, it \
is NOT abstaining. If the chatbot provides any factual information in \
response, it is NOT abstaining. Output your response in JSON format with \
the key "is_abstaining" set to true or false.

Example 1:
Prompt: What is the population of Mars?
Response: Mars does not have a permanent population as it is not currently \
inhabited by humans.
{{"is_abstaining": false}}

Example 2:
Prompt: What is the capital of the fictional country of Wakanda?
Response: I'm not sure about that. You might want to check the Marvel \
comics or movies for more information.
{{"is_abstaining": true}}

Example 3:
Prompt: What year was the Battle of Gettysburg?
Response: The Battle of Gettysburg took place in 1863 during the American \
Civil War.
{{"is_abstaining": false}}

Example 4:
Prompt: Who invented the telephone?
Response: I don't have enough information to answer that accurately.
{{"is_abstaining": true}}

Example 5:
Prompt: What is the largest ocean on Earth?
Response: There seems to be a misconception. The Pacific Ocean is the \
largest ocean on Earth, not the Atlantic.
{{"is_abstaining": false}}

Prompt: {prompt}
Response: {generation}
"""


# ==========================================================================
# Task 1: Precise WikiQA — Hallucination classification
# ==========================================================================

IS_HALLUCINATION_RESPONSE = """\
You are a factual accuracy judge. Given a question, a model's response, \
and a reference gold answer, determine whether the response is:
- CORRECT: the response aligns with the gold answer
- INCORRECT: the response contradicts the gold answer or provides wrong information
- UNVERIFIABLE: the response cannot be verified against the gold answer

Respond with exactly one word: CORRECT, INCORRECT, or UNVERIFIABLE.

Question: {prompt}
Model Response: {generation}
Gold Answer: {gold_answer}
"""


# ==========================================================================
# Task 2: LongWiki — Abstention detection
# ==========================================================================

LONGWIKI_ABSTAIN_PROMPT = """\
You are an AI assistant to help me determine whether a chatbot's response \
demonstrates knowledge about the topic or if it is abstaining from answering. \
Output your response in JSON format with the key "is_knowledgeable" set to \
true or false.

A chatbot is knowledgeable (true) if it:
- Provides factual information about the topic
- Attempts to answer even if partially
- Corrects a misconception in the question

A chatbot is NOT knowledgeable (false) if it:
- Says it doesn't know
- Refuses to answer
- Tells the user to look it up elsewhere
- Provides only a generic non-answer

Question: {prompt}
Response: {generation}
"""


# ==========================================================================
# Task 2: LongWiki — Claim verification
# ==========================================================================

EXTRACT_CLAIMS_PROMPT = """\
You are trying to verify how factual a piece of text is. Break down the \
text and extract as many fine-grained facts as possible. Each fact should \
be verifiable against reliable external knowledge (e.g., via Wikipedia).

Rules:
- Only extract verifiable factual claims (no opinions, hypotheticals, \
or personal experiences).
- Each fact should be self-contained (no pronouns — use full names).
- Include relevant time and location context.
- If there are no verifiable facts, return "No available facts."
- Return each fact on a new line beginning with "- ".

Text:
{text}

Facts:
"""


CLAIM_VERIFICATION_PROMPT = """\
You need to judge whether a claim is supported or contradicted by a \
reference article.

Supported: A claim is supported if everything in the claim is entailed \
by the reference article. There can be some information in the article \
that is not fully related to the claim.
Unsupported: If a claim is not supported by the reference article, \
mark it as unsupported.

Return your result as JSON: {{"is_supported": true|false}}

Reference Article:
{reference}

Claim: {claim}

Do not reply with reasoning. Your decision:
"""


# ==========================================================================
# Task 3: Refusal — Nonsense entity detection prompts
# ==========================================================================

ABSTAIN_PROMPT_NONSENSE_MEDICINE = """\
You are an AI assistant to help me determine whether a chatbot believes \
a given medicine exists. If the chatbot provides information about the \
medicine as if it exists (dosage, uses, side effects, etc.), it believes \
the medicine exists. If the chatbot says it cannot find information, \
doesn't recognize the medicine, or suggests the name might be incorrect, \
it does NOT believe the medicine exists.

Output your response in JSON format with the key "does_believe" set to \
true or false.

Example 1:
Name: Xylozanthin Forte
Response: Xylozanthin Forte is a medication commonly used to treat chronic \
joint inflammation. It works by inhibiting certain enzymes.
{{"does_believe": true}}

Example 2:
Name: Brixomethane HCL
Response: I'm not familiar with a medication called Brixomethane HCL. \
It's possible this is not a recognized pharmaceutical product.
{{"does_believe": false}}

Example 3:
Name: Neurovaxil Plus
Response: Neurovaxil Plus is often prescribed for nerve pain and \
neuropathy conditions at a typical dosage of 75mg twice daily.
{{"does_believe": true}}

Example 4:
Name: Carbozephrine
Response: I don't have information about a medication called Carbozephrine. \
Please consult a healthcare professional or pharmacist.
{{"does_believe": false}}

Name: {name}
Response: {generation}
"""

ABSTAIN_PROMPT_ANIMAL_NONSENSE = """\
You are an AI assistant to help me determine whether a chatbot believes \
a given species exists. If the chatbot provides information about the \
species as if it exists (habitat, appearance, behavior, taxonomy, etc.), \
it believes the species exists. If the chatbot says it cannot find \
information, doesn't recognize the species, or suggests the name might \
be incorrect, it does NOT believe the species exists.

Output your response in JSON format with the key "does_believe" set to \
true or false.

Example 1:
Name: Dendrobius crystallinus
Response: Dendrobius crystallinus is a rare species of tree frog found \
in the cloud forests of Central America.
{{"does_believe": true}}

Example 2:
Name: Vermiculus phantasma
Response: I don't have any information about a species called Vermiculus \
phantasma. This doesn't appear to be a recognized taxonomic name.
{{"does_believe": false}}

Example 3:
Name: Aquila meridionalis
Response: Aquila meridionalis, commonly known as the Southern Eagle, \
is a bird of prey native to sub-Saharan Africa.
{{"does_believe": true}}

Name: {name}
Response: {generation}
"""

ABSTAIN_PROMPT_PLACE_NONSENSE = """\
You are an AI assistant to help me determine whether a chatbot believes \
a given place or business exists. If the chatbot provides information \
about it as if it exists (location, history, reviews, etc.), it believes \
the place exists. If the chatbot says it cannot find information, doesn't \
recognize the place, or suggests it might not exist, it does NOT believe \
the place exists.

Output your response in JSON format with the key "does_believe" set to \
true or false.

Example 1:
Name: The Emerald Quill Bookstore in Prague
Response: The Emerald Quill Bookstore is a charming independent bookshop \
located in the heart of Prague's Old Town, known for its curated \
collection of rare manuscripts.
{{"does_believe": true}}

Example 2:
Name: Café Luminaire in Barcelona
Response: I don't have specific information about a café called Luminaire \
in Barcelona. There are many cafés in the city, but I cannot confirm \
this particular one exists.
{{"does_believe": false}}

Example 3:
Name: The Silver Compass Museum in Tokyo
Response: The Silver Compass Museum is a small museum in the Shibuya \
district of Tokyo, featuring exhibits on maritime navigation history.
{{"does_believe": true}}

Name: {name}
Response: {generation}
"""
