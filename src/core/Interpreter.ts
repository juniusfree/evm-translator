/* eslint-disable @typescript-eslint/no-non-null-assertion */
import defaultContractInterpreters from './contractInterpreters'
import collect from 'collect.js'
import {
    Address,
    Chain,
    Decoded,
    Interaction,
    InteractionEvent,
    Interpretation,
    RawTxData,
    Token,
    TokenType,
} from 'interfaces'

function deepCopy(obj: any) {
    return JSON.parse(JSON.stringify(obj))
}

type ContractInterpretersMap = Record<Address, any>

type KeyMapping = {
    key: string
    default_value: string
    filters?: {
        event?: string
        to?: string
        from?: string
        value?: string
    } & Record<string, string>
    index?: number
    prefix?: string
    postfix?: string
}

const TopLevelInteractionKeys = ['contractName', 'contractSymbol', 'contractAddress', 'logIndex']
function isTopLevel(key: string) {
    return TopLevelInteractionKeys.includes(key)
}

class Interpreter {
    contractSpecificInterpreters: ContractInterpretersMap
    // fallbackInterpreters: Array<Inspector> = []
    userAddress: Address
    chain: Chain

    constructor(
        userAddress: Address,
        contractInterpreters: ContractInterpretersMap = defaultContractInterpreters,
        chain: Chain,
    ) {
        this.contractSpecificInterpreters = contractInterpreters
        // this.fallbackInterpreters = [] //Todo
        this.userAddress = userAddress
        this.chain = chain
    }

    public interpret(rawTxData: RawTxData, decodedData: Decoded): Interpretation {
        const method = decodedData.contractMethod!
        const interactions = decodedData.interactions!

        const toAddress = rawTxData.transactionReceipt.to as Address
        const fromAddress = rawTxData.transactionReceipt.from as Address

        // let interpretationMapping
        // let methodSpecificMapping
        let interpretation: Interpretation

        console.log('decodedData', decodedData)

        // not contract-specific
        interpretation = {
            nativeTokenValueSent: decodedData.nativeTokenValueSent,
            tokens_received: this.getTokensReiceived(interactions, this.userAddress),
            tokens_sent: this.getTokensSent(interactions, this.userAddress),
        }

        const interpretationMapping = this.contractSpecificInterpreters[toAddress]
        const methodSpecificMapping = interpretationMapping?.[method]

        // contract-specific interpretation
        if (interpretationMapping && methodSpecificMapping) {
            const keyValueMap = this.useMapping(interactions, interpretationMapping, methodSpecificMapping)

            keyValueMap.nativeTokenValueSent = decodedData.nativeTokenValueSent!
            keyValueMap.user_name = decodedData.fromENS || fromAddress.substring(0, 6)

            // generate example description
            const exampleDescription = this.fillDescriptionTemplate(
                interpretationMapping[method].example_description_template,
                keyValueMap,
            )

            interpretation = {
                ...interpretation,
                ...keyValueMap,
                example_description: exampleDescription,
            }

            // interpretation.contract_name = keyValueMap.contract_name
            // interpretation.action = keyValueMap.action as Action
            // interpretation.example_description = exampleDescription
        } else {
            // fallback interpretation
        }

        return interpretation
    }

    private findValue(interactions: Interaction[], keyMapping: KeyMapping, userAddress: Address): string {
        const filters = keyMapping.filters || {}
        const index = keyMapping.index || 0

        // console.log('interactions', interactions)
        let filteredInteractions = deepCopy(interactions) as Interaction[]

        // console.log('interactions', interactions)

        interactions.forEach((interaction) => {
            interaction.events.forEach((event) => {
                console.log('event', event)
            })
        })

        for (const [key, value] of Object.entries(filters)) {
            let valueToFind = value

            // special case for when we want to match on the contextualized user address
            if (value === '{user_address}') valueToFind = userAddress

            // filter out by events that don't have the keys we want
            for (const interaction of filteredInteractions) {
                if (!isTopLevel(key)) {
                    interaction.events = interaction.events.filter((d) => d[key] === valueToFind)
                }
            }

            // if there aren't any events left, we don't want that interaction
            filteredInteractions = filteredInteractions.filter((i) => i.events.length > 0)

            // filter out interactions by top level key
            if (isTopLevel(key)) {
                filteredInteractions = filteredInteractions.filter((i) => i[key as keyof typeof i] === valueToFind)
            }
        }
        console.log('keyMapping.key', keyMapping.key)

        const interaction = filteredInteractions[index]
        const prefix = keyMapping.prefix || ''
        const str =
            interaction?.[keyMapping.key as keyof typeof interaction] || interaction?.events[index]?.[keyMapping.key]
        const postfix = keyMapping.postfix || ''
        const value = str ? prefix + str + postfix : keyMapping.default_value

        return value
    }

    private getTokens(interactions: Interaction[], userAddress: Address, direction: 'to' | 'from'): Token[] {
        let tokens: Token[] = []

        let filteredInteractions = deepCopy(interactions) as Interaction[]

        const toKeys = ['to', '_to']
        const fromKeys = ['from', '_from']
        const transferEvents = ['Transfer', 'TransferBatch', 'TransferSingle']

        // filter non-transfer  events only
        for (const interaction of filteredInteractions) {
            interaction.events = interaction.events.filter((d) => transferEvents.includes(d.event))
        }

        // filter out interactions without any of the events we want
        filteredInteractions = filteredInteractions.filter(
            (i) =>
                i.events.filter(
                    (d) =>
                        transferEvents.includes(d.event) && // filters out all non transfer events
                        toOrFromUser(d, direction, userAddress), // filters out event objects that aren't the right direction, and to the user
                ).length > 0, // filters out interactions that don't have any events objects left
        )

        function getTokenType(interaction: Interaction): TokenType {
            const LPTokenSymbols = ['UNI-V2']
            let tokenType = TokenType.DEFAULT

            // LP Token
            if (LPTokenSymbols.includes(interaction.contract_symbol)) {
                tokenType = TokenType.LPToken
                // ERC-1155
            } else if (interaction.events[0]._amount || interaction.events[0]._amounts) {
                tokenType = TokenType.ERC1155
                // ERC-721
            } else if (interaction.events[0].tokenId) {
                tokenType = TokenType.ERC721
                // ERC-20
            } else if (Number(interaction.events[0].value) > 0) {
                tokenType = TokenType.ERC20
            }

            return tokenType
        }

        function toOrFromUser(event: InteractionEvent, direction: 'to' | 'from', userAddress: Address) {
            const directionArr = direction === 'to' ? toKeys : fromKeys
            return directionArr.filter((key) => event[key] === userAddress).length > 0
        }

        console.log('filteredInteractions', filteredInteractions)

        // TODO this is only ERC20 tokens
        tokens = filteredInteractions.map((i) => {
            const tokenType = getTokenType(i)

            console.log('token', i.events)

            return {
                type: tokenType,
                name: i.contract,
                symbol: i.contract_symbol,
                address: i.contract_address,
                amount: i.events[0].value,
                tokenId: i.events[0].tokenId,
            }
        })

        return tokens
    }

    private getTokensReiceived(interactions: Interaction[], userAddress: Address): Token[] {
        return this.getTokens(interactions, userAddress, 'to')
    }

    private getTokensSent(interactions: Interaction[], userAddress: Address): Token[] {
        return this.getTokens(interactions, userAddress, 'from')
    }

    private useMapping(interactions: Interaction[], interpretationMapping: any, methodSpecificMapping: any) {
        const includeKeys = ['action', 'contract_name', 'example_description']
        const excludeKeys = ['example_description', 'exmaple_description_template']
        const variableKeys = Object.keys(methodSpecificMapping)

        const keysRequired: Array<string> = collect(variableKeys).except(excludeKeys).concat(includeKeys).all()

        console.log('keysRequired', keysRequired)
        const keyValueMap: Record<string, string> = {}

        for (const key of keysRequired) {
            const methodSpecificValue = methodSpecificMapping[key]

            // contract_address is in the top level
            if (interpretationMapping[key]) {
                keyValueMap[key] = interpretationMapping[key]

                // action and others are store in the methodSpecificMapping
            } else if (typeof methodSpecificValue === 'string') {
                keyValueMap[key] = methodSpecificValue

                // project_name and other data is stored somewhere in the interactions
            } else if (typeof methodSpecificValue === 'object') {
                keyValueMap[key] = this.findValue(interactions, methodSpecificValue, this.userAddress)
            }
        }

        console.log('keyValueMap', keyValueMap)

        return keyValueMap
    }

    private fillDescriptionTemplate(template: string, keyValueMap: Record<string, string>) {
        for (const key in keyValueMap) {
            const value = keyValueMap[key]

            template = template.replace(`{${key}}`, value)
        }

        return template
    }
}

export default Interpreter