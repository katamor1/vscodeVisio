int build_report(int a, int b, int c, int d) {
    // 集計値を初期化
    int total = 0;
    int status = 0;
    int retry = 0;
    int bucket = 0;
    for (int i = 0; i < 4; i++) {
        total += i; // add loop index
        if (a > i) {
            total += a;
            if (b > total) {
                total += b;
                while (retry < 3) {
                    retry++;
                    total += retry;
                    if (c == retry) {
                        total += c;
                        switch (d) {
                            case 0:
                                bucket = total + 1;
                                total += bucket;
                                break;
                            case 1:
                                bucket = total + 2;
                                total += bucket;
                                break;
                            default:
                                bucket = total + 3;
                                total += bucket;
                                break;
                        }
                    } else {
                        total -= c;
                    }
                    status += total;
                }
            } else {
                total -= b;
                do {
                    retry++;
                    total += retry;
                    if (retry > d) {
                        status += retry;
                    } else {
                        status -= retry;
                    }
                } while (retry < 2);
            }
        } else {
            total -= a;
            if (b == i) {
                total += 10;
                for (int j = 0; j < 3; j++) {
                    total += j;
                    if (j == c) {
                        status += j;
                    } else {
                        status -= j;
                    }
                    bucket += status;
                }
            } else {
                total -= 10;
                switch (c) {
                    case 4:
                        status += 4;
                        total += status;
                        break;
                    case 5:
                        status += 5;
                        total += status;
                        break;
                    default:
                        status += 6;
                        total += status;
                        break;
                }
            }
        }
        total += status;
        status += bucket;
        total += retry;
        bucket += i;
    }
    total += 1;
    total += 2;
    total += 3;
    total += 4;
    status += 1;
    status += 2;
    status += 3;
    bucket += total;
    bucket += status;
    retry += bucket;
    total += retry;
    status += total;
    if (total > 100) {
        status = total;
    } else {
        status = -total;
    }
    total += bucket;
    return status + total;
}
