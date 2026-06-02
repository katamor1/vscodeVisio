void sample(int flag, int value[], int *result)
{
    *result = 0; // 初期化
    
    /* フラグをチェック */
    if (flag) {
        // Do something when flag is true
        *result = 1;
    } else {
        // Do something else when flag is false
        *result = 0;
    }

    // Check the first element of the value array and update result accordingly
    if(value[0] > 0)
    {
        for(int i = 0; i < value[0]; i++) // Loop through the first value[0] elements of the value array
        {
            *result += value[i]; // Add each element to result

            if(*result > 100) // Check if result exceeds 100
            {
                *result = 100; // Cap result at 100
                break; // Exit the loop if result exceeds 100
            }
        }
    }

    /* Wait until g_flag becomes false
     * This is a simple busy-wait loop that checks the value of g_flag every second.
     * In a real application, you might want to use a more efficient synchronization mechanism.
     */
    while(g_flag)
    {
        if(g_flag < 0) // Check if g_flag is negative
        {
            *result = -1; // Set result to -1 if g_flag is negative
            return; // Exit the function if g_flag is negative
        }
        // Do nothing, just wait
        Sleep(1000);
    }
    /* 戻り値なし */
}
