import { Address } from 'interfaces'
import { ABI_ItemUnfiltered } from 'interfaces/abi'
import { RateLimiter } from 'limiter'
import { fetcher } from 'utils'

export type SourceCodeObject = {
    SourceCode: string
    ABI: string
    ContractName: string
    CompilerVersion: string
    OptimizationUsed: string
    Runs: string
    ConstructorArguments: string
    EVMVersion: string
    Library: string
    LicenseType: string
    Proxy: string
    Implementation: string
    SwarmSource: string
}

export default class Etherscan {
    baseUrl = 'https://api.etherscan.io/api'
    apiKey: string
    limiter = new RateLimiter({ tokensPerInterval: 4, interval: 'second' })

    constructor(apiKey: string) {
        this.apiKey = apiKey
    }

    createUrl(params: Record<string, any>): string {
        const url = new URL(this.baseUrl)
        url.searchParams.set('apikey', this.apiKey)
        Object.entries(params).forEach(([key, value]) => {
            url.searchParams.set(key, value)
        })
        return url.toString()
    }

    async getABI(contractAddress: Address): Promise<ABI_ItemUnfiltered[]> {
        const params = {
            module: 'contract',
            action: 'getabi',
            address: contractAddress,
        }

        const remaining = await this.limiter.removeTokens(1)

        if (remaining < 1) {
            console.log('etherscan rate limiter engaged. tokens remaining:', remaining)
        }

        const response = await fetcher(this.createUrl(params))

        if (response.status !== '1') {
            throw new Error(`Etherscan API error: ${response.result}`)
            return []
        }

        return JSON.parse(response.result)
    }

    async getSourceCode(contractAddress: Address): Promise<SourceCodeObject> {
        const params = {
            module: 'contract',
            action: 'getsourcecode',
            address: contractAddress,
        }
        const remaining = await this.limiter.removeTokens(1)

        if (remaining < 1) {
            console.log('etherscan rate limiter engaged. tokens remaining:', remaining)
        }

        const response = await fetcher(this.createUrl(params))

        if (response.status !== '1') {
            throw new Error(`Etherscan API error bad statuss: ${response.result}`)
        }

        if (response.result[0].ABI === 'Contract source code not verified') {
            throw new Error(`Etherscan API error not verified: ${response.result.ABI}`)
        }

        return response.result[0]
    }
}