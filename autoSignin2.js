/*
cron "0 9 * * *" autoSignin.js, tag=阿里云盘签到
*/

const axios = require('axios')
const { initInstance, getEnv, updateCkEnv } = require('./qlApi.js')
const notify = require('./sendNotify')

const updateAccesssTokenURL = 'https://auth.aliyundrive.com/v2/account/token'
const signinURL =
    'https://member.aliyundrive.com/v2/activity/sign_in_list?_rx-s=mobile'
const rewardURL =
    'https://member.aliyundrive.com/v1/activity/sign_in_reward?_rx-s=mobile'
const taskUrl = 'https://member.aliyundrive.com/v2/activity/sign_in_task_reward?_rx-s=mobile'

// 使用 refresh_token 更新 access_token
function updateAccesssToken(queryBody, remarks) {
    const errorMessage = [remarks, '更新 access_token 失败']
    return axios(updateAccesssTokenURL, {
        method: 'POST',
        data: queryBody,
        headers: { 'Content-Type': 'application/json' }
    })
        .then(d => d.data)
        .then(d => {
            const { code, message, nick_name, refresh_token, access_token } = d
            if (code) {
                if (
                    code === 'RefreshTokenExpired' ||
                    code === 'InvalidParameter.RefreshToken'
                )
                    errorMessage.push('refresh_token 已过期或无效')
                else errorMessage.push(message)
                return Promise.reject(errorMessage.join(', '))
            }
            return { nick_name, refresh_token, access_token }
        })
        .catch(e => {
            errorMessage.push(e.message)
            return Promise.reject(errorMessage.join(', '))
        })
}

//签到列表
function sign_in(access_token, remarks) {
    const sendMessage = [remarks]
    const authorization = "Bearer " + access_token;
    return axios(signinURL, {
        method: 'POST',
        data: {

        },
        headers: {
            Authorization: authorization,
            'Content-Type': 'application/json'
        }
    })
        .then(d => d.data)
        .then(async json => {
            if (!json.success) {
                sendMessage.push('签到失败', json.message)
                return Promise.reject(sendMessage.join(', '))
            }

            sendMessage.push('签到成功')

            const { signInInfos, signInCount } = json.result
            const currentSignInfo = signInInfos[signInCount - 1] // 当天签到信息

            sendMessage.push(`本月累计签到 ${signInCount} 天`)

            // 未领取奖励列表
            const { reward_signin, reward_task, reward_task_unfinished } = filter_unget_rewards(signInInfos, signInCount);

            // 领取签到奖励
            var signInDay;
            if (reward_signin.length) {
                sendMessage.push("开始领取签到奖励：" + reward_signin.length);
                for await (reward of reward_signin) {
                    signInDay = reward.day;
                    try {
                        const rewardInfo = await getReward(access_token, signInDay)
                        sendMessage.push(
                            `第${signInDay}天奖励领取成功: 获得[${rewardInfo.name || ''}]${rewardInfo.description || ''
                            }`
                        )
                    } catch (e) {
                        sendMessage.push(`第${signInDay}天奖励领取失败:`, e)
                    }
                }
            } else if ('verification' === currentSignInfo.rewards[0].status) {
                sendMessage.push(
                    `今日签到获得${currentSignInfo.rewards[0].name || ''}${currentSignInfo.rewards[0].description || ''
                    }`
                )
            }

            if (reward_task.length > 0) {
                sendMessage.push("开始领取任务奖励：" + reward_task.length);
                for await (reward of reward_task) {
                    signInDay = reward.day;
                    try {
                        const rewardInfo = await getTaskReward(access_token, signInDay)
                        sendMessage.push(
                            `第${signInDay}天奖励领取成功: 获得[${rewardInfo.name || ''}]${rewardInfo.description || ''}-${rewardInfo.notice || ''}`
                        )
                    } catch (e) {
                        sendMessage.push(`第${signInDay}天奖励领取失败:`, e)
                    }
                }
            }

            if (reward_task_unfinished.length > 0) {
                var days = reward_task_unfinished.forEach((e) => {
                    return e.day;
                })
                sendMessage.push("第" + days.join(", ") + "日任务未完成，未能领取奖励")
            }

            return sendMessage.join(', ')
        })
        .catch(e => {
            sendMessage.push('签到失败')
            sendMessage.push(e.message)
            return Promise.reject(sendMessage.join(', '))
        })
}

/**
 * 获取未领取的奖励
 * @param {签到返回的result.signInInfos} signInInfos 
 */
function filter_unget_rewards(signInInfos, signInCount) {
    var rewards;
    var reward_signin = []
    var reward_task = []
    var reward_task_unfinished = []
    for (info in signInInfos) {

        rewards = info.rewards;
        if (info.day <= signInCount) {//只取签到当天及其以前的rewards数据
            for (reward in rewards) {
                reward.day = info.day;//保存一下是第几天，领取奖励时会用到。
                if ('dailySignIn' === reward.type && 'verification' != reward.status) {
                    reward_signin.push(reward);
                }
                else if ('dailyTask' === reward.type) {
                    if ('finished' === reward.status) {
                        reward_task.push(reward)//一定要完成的task才能领取奖励
                    } else {
                        reward_task_unfinished.push(reward)
                    }
                }
            }
        }

    }

    return { reward_signin, reward_task, reward_task_unfinished };
}

// 领取奖励
function getReward(access_token, signInDay) {
    return axios(rewardURL, {
        method: 'POST',
        data: { signInDay },
        headers: {
            authorization: access_token,
            'Content-Type': 'application/json'
        }
    })
        .then(d => d.data)
        .then(json => {
            if (!json.success) {
                return Promise.reject(json.message)
            }

            return json.result
        })
}

/**
 * 领取每日任务奖励
 * @param {*} access_token 
 * @param {奖励日期} signInDay 
 */
function getTaskReward(access_token, signInDay) {
    return axios(taskUrl, {
        method: 'POST',
        data: {
            signInDay
        },
        headers: {
            authorization: ("Bearer " + access_token),
            'Content-Type': 'application/json'
        }
    })
        .then(d => d.data)
        .then(json => {
            if (!json.success) {
                return Promise.reject(json.message)
            }

            return json.result
        })
}

// 获取环境变量
async function getRefreshToken() {
    let instance = null
    try {
        instance = await initInstance()
    } catch (e) { }

    let refreshToken = process.env.refreshToken || []
    try {
        if (instance) refreshToken = await getEnv(instance, 'refreshToken')
    } catch (e) { }

    let refreshTokenArray = []

    if (Array.isArray(refreshToken)) refreshTokenArray = refreshToken
    else if (refreshToken.indexOf('&') > -1)
        refreshTokenArray = refreshToken.split('&')
    else if (refreshToken.indexOf('\n') > -1)
        refreshTokenArray = refreshToken.split('\n')
    else refreshTokenArray = [refreshToken]

    if (!refreshTokenArray.length) {
        console.log('未获取到refreshToken, 程序终止')
        process.exit(1)
    }

    return {
        instance,
        refreshTokenArray
    }
}

!(async () => {
    const { instance, refreshTokenArray } = await getRefreshToken()

    const message = []
    let index = 1
    for await (refreshToken of refreshTokenArray) {
        let remarks = refreshToken.remarks || `账号${index}`
        const queryBody = {
            grant_type: 'refresh_token',
            refresh_token: refreshToken.value || refreshToken
        }

        try {
            const { nick_name, refresh_token, access_token } =
                await updateAccesssToken(queryBody, remarks)

            if (nick_name && nick_name !== remarks)
                remarks = `${nick_name}(${remarks})`

            // 更新环境变量
            if (instance) {
                let params = {
                    name: refreshToken.name,
                    value: refresh_token,
                    remarks: refreshToken.remarks || nick_name // 优先存储原有备注信息
                }
                // 新版青龙api
                if (refreshToken.id) {
                    params.id = refreshToken.id
                }
                // 旧版青龙api
                if (refreshToken._id) {
                    params._id = refreshToken._id
                }
                await updateCkEnv(instance, params)
            }

            const sendMessage = await sign_in(access_token, remarks)
            console.log(sendMessage)
            console.log('\n')
            message.push(sendMessage)
        } catch (e) {
            console.log(e)
            console.log('\n')
            message.push(e)
        }
        index++
    }
    await notify.sendNotify(`阿里云盘签到`, message.join('\n'))
})()
